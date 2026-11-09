import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DnsReferenceParser,
  OzonReferenceParser,
  type ProductReferenceEntity,
  ResolveProductReferenceUseCase,
  WildberriesReferenceParser,
} from 'product-reference';

import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import {
  type FetchPricesListenerInterface,
  FetchPricesUseCase,
  type ProductFetchResultInterface,
} from './fetch-prices.use-case.js';
import type { ProductBatchReaderPort } from './product-batch-reader.port.js';
import type { ProductReaderPort } from './product-reader.port.js';

/** Reads the products of a batch one after another, as the reader of a marketplace without batches does. */
function oneByOne(reader: ProductReaderPort): ProductBatchReaderPort {
  return {
    readMany: async (references, proxy, signal): Promise<ReadProductResultType[]> => {
      const results: ReadProductResultType[] = [];
      for (const reference of references) results.push(await reader.read(reference, proxy, signal));

      return results;
    },
  };
}

const trackedProductId = '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33';
const product = { trackedProductId, url: 'https://www.ozon.ru/product/1/' };
const proxy = 'socks5://217.71.230.103:1080';

async function fetchOne(
  servers: string[],
  reader: ProductReaderPort,
): Promise<ProductFetchResultInterface | undefined> {
  const results: ProductFetchResultInterface[] = [];
  const listener: FetchPricesListenerInterface = {
    onProgress: (): Promise<void> => Promise.resolve(),
    onProduct: (result): Promise<void> => {
      results.push(result);

      return Promise.resolve();
    },
  };

  await new FetchPricesUseCase(
    new ResolveProductReferenceUseCase([new OzonReferenceParser()]),
    (): ProductBatchReaderPort => oneByOne(reader),
  ).execute(
    {
      routes: servers.map((server) => ({ server })),
      products: [product],
      timeoutMs: 1000,
    },
    new AbortController().signal,
    listener,
  );

  return results[0];
}

void test('stops at a challenge instead of rotating proxies or claiming out-of-stock', async (): Promise<void> => {
  let calls = 0;

  const result = await fetchOne([proxy, proxy], {
    read: (): Promise<ReadProductResultType> => {
      calls += 1;

      return Promise.resolve({ status: 'challenge_required' });
    },
  });

  assert.equal(calls, 1);
  assert.equal(result?.status, 'challenge_required');
});

void test('reads the product through the proxy of its route', async (): Promise<void> => {
  const result = await fetchOne([proxy], {
    read: (_reference, endpoint): Promise<ReadProductResultType> => {
      assert.equal(endpoint.server, proxy);

      return Promise.resolve({ status: 'network_error' });
    },
  });

  assert.deepEqual(
    result?.attempts.map(({ proxy: server, result: read }) => ({ server, read })),
    [{ server: proxy, read: { status: 'network_error', stage: 'page' } }],
  );
  assert.equal(typeof result.attempts[0]?.durationMs, 'number');
});

void test('reports no proxies without routes', async (): Promise<void> => {
  const result = await fetchOne([], {
    read: (): Promise<ReadProductResultType> => {
      throw new Error('Must not read');
    },
  });

  assert.deepEqual(result, { trackedProductId, status: 'no_proxies', attempts: [] });
});

void test('gives the reader the city the product is asked for in', async (): Promise<void> => {
  const cities: Array<string | null> = [];
  const reader: ProductReaderPort = {
    read: (reference: ProductReferenceEntity): Promise<ReadProductResultType> => {
      cities.push(reference.cityId);

      return Promise.resolve({ status: 'parse_error' });
    },
  };
  const cityId = '30b7c1f1-03fb-11dc-95ee-00151716f9f5';

  for (const given of [{ cityId }, {}]) {
    await new FetchPricesUseCase(
      new ResolveProductReferenceUseCase([new DnsReferenceParser()]),
      (): ProductBatchReaderPort => oneByOne(reader),
    ).execute(
      {
        routes: [{ server: proxy }],
        products: [
          {
            trackedProductId,
            url: 'https://www.dns-shop.ru/product/0463bb2411a1d582/',
            ...given,
          },
        ],
        timeoutMs: 1000,
      },
      new AbortController().signal,
      {
        onProgress: (): Promise<void> => Promise.resolve(),
        onProduct: (): Promise<void> => Promise.resolve(),
      },
    );
  }

  assert.deepEqual(cities, [cityId, null]);
});

void test('learns its routes as it goes: the next product starts on the one that read and tries the failed ones last', async (): Promise<void> => {
  const dead = 'socks5://217.71.230.1:1080';
  const refused = 'socks5://217.71.230.2:1080';
  const good = 'socks5://217.71.230.3:1080';
  const spare = 'socks5://217.71.230.4:1080';
  const tried: string[][] = [];
  const answers: Readonly<Record<string, ReadProductResultType>> = {
    [dead]: { status: 'network_error' },
    [refused]: { status: 'http_error', httpStatus: 403 },
    [good]: {
      status: 'success',
      snapshot: {
        title: 'Notebook',
        observedAt: '2026-11-03T08:00:00.000Z',
        prices: [{ amountMinor: 10000000, currency: 'RUB' }],
        availability: 'in_stock',
        imageUrl: null,
      },
      exitIp: '217.71.230.3',
    },
  };
  const products = ['1', '2'].map((id) => ({
    trackedProductId: `9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d3${id}`,
    url: `https://www.ozon.ru/product/${id}/`,
  }));

  const routes = await new FetchPricesUseCase(
    new ResolveProductReferenceUseCase([new OzonReferenceParser()]),
    (): ProductBatchReaderPort =>
      oneByOne({
        read: (reference, endpoint): Promise<ReadProductResultType> => {
          if (tried.at(-1)?.[0] !== reference.url) tried.push([reference.url]);
          tried.at(-1)?.push(endpoint.server);

          return Promise.resolve(answers[endpoint.server] ?? { status: 'network_error' });
        },
      }),
  ).execute(
    {
      routes: [dead, 'socks5://127.0.0.1:1080', refused, good, spare].map((server) => ({ server })),
      products,
      timeoutMs: 1000,
    },
    new AbortController().signal,
    {
      onProgress: (): Promise<void> => Promise.resolve(),
      onProduct: (): Promise<void> => Promise.resolve(),
    },
  );

  // The first product: the dead route, then the refusal ends it, as a refusal of the site is not rotated around.
  // The second starts on the routes the first did not try: the dead and the refused ones go last.
  assert.deepEqual(tried, [
    ['https://www.ozon.ru/product/1/', dead, refused],
    ['https://www.ozon.ru/product/2/', good],
  ]);
  assert.deepEqual(
    routes.map(({ server }): string => server),
    [good, spare, dead, refused, 'socks5://127.0.0.1:1080'],
  );
});

const silentListener: FetchPricesListenerInterface = {
  onProgress: (): Promise<void> => Promise.resolve(),
  onProduct: (): Promise<void> => Promise.resolve(),
};

void test('a route that does not reach the site fails at once, before a browser is opened for it', async (): Promise<void> => {
  const dead = 'socks5://217.71.230.1:1080';
  const read: string[] = [];
  const results: ProductFetchResultInterface[] = [];

  await new FetchPricesUseCase(
    new ResolveProductReferenceUseCase([new OzonReferenceParser()]),
    (): ProductBatchReaderPort =>
      oneByOne({
        read: (_reference, endpoint): Promise<ReadProductResultType> => {
          read.push(endpoint.server);

          return Promise.resolve({ status: 'parse_error' });
        },
      }),
    undefined,
    {
      probe: {
        reaches: (endpoint, host): Promise<boolean> => {
          assert.equal(host, 'www.ozon.ru');

          return Promise.resolve(endpoint.server !== dead);
        },
      },
    },
  ).execute(
    { routes: [{ server: dead }, { server: proxy }], products: [product], timeoutMs: 1000 },
    new AbortController().signal,
    {
      ...silentListener,
      onProduct: (result): Promise<void> => {
        results.push(result);

        return Promise.resolve();
      },
    },
  );

  assert.deepEqual(read, [proxy]);
  assert.deepEqual(
    results[0]?.attempts.map(({ result }): ReadProductResultType => result),
    [
      { status: 'network_error', stage: 'preflight' },
      { status: 'parse_error', stage: 'page' },
    ],
  );
});

void test('reads the products of a marketplace that reads several at once in batches of one city', async (): Promise<void> => {
  const batches: string[][] = [];
  const ids = ['1', '2', '3', '4'];
  const products = ids.map((id) => ({
    trackedProductId: `9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d3${id}`,
    url: `https://www.wildberries.ru/catalog/${id}/detail.aspx`,
    ...(id === '3' ? { cityId: '-5827226' } : {}),
  }));

  await new FetchPricesUseCase(
    new ResolveProductReferenceUseCase([new WildberriesReferenceParser()]),
    (): ProductBatchReaderPort => ({
      readMany: (references): Promise<ReadProductResultType[]> => {
        batches.push(references.map(({ id, cityId }): string => `${id}@${cityId ?? ''}`));

        return Promise.resolve(
          references.map((): ReadProductResultType => ({ status: 'parse_error' })),
        );
      },
    }),
    undefined,
    { batchLimits: { wildberries: 2 } },
  ).execute(
    { routes: [{ server: proxy }], products, timeoutMs: 1000 },
    new AbortController().signal,
    silentListener,
  );

  assert.deepEqual(batches, [['1@', '2@'], ['4@'], ['3@-5827226']]);
});

void test('tries the next route only for the products of a batch the last one left open', async (): Promise<void> => {
  const dead = 'socks5://217.71.230.1:1080';
  const asked: string[][] = [];
  const results: ProductFetchResultInterface[] = [];
  const products = ['1', '2'].map((id) => ({
    trackedProductId: `9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d3${id}`,
    url: `https://www.wildberries.ru/catalog/${id}/detail.aspx`,
  }));

  await new FetchPricesUseCase(
    new ResolveProductReferenceUseCase([new WildberriesReferenceParser()]),
    (): ProductBatchReaderPort => ({
      readMany: (references, endpoint): Promise<ReadProductResultType[]> => {
        asked.push(references.map(({ id }): string => id));

        return Promise.resolve(
          references.map(({ id }): ReadProductResultType =>
            endpoint.server === dead && id === '2'
              ? { status: 'network_error' }
              : { status: 'parse_error' },
          ),
        );
      },
    }),
    undefined,
    { batchLimits: { wildberries: 2 } },
  ).execute(
    { routes: [{ server: dead }, { server: proxy }], products, timeoutMs: 1000 },
    new AbortController().signal,
    {
      ...silentListener,
      onProduct: (result): Promise<void> => {
        results.push(result);

        return Promise.resolve();
      },
    },
  );

  assert.deepEqual(asked, [['1', '2'], ['2']]);
  assert.deepEqual(
    results.map(({ status, attempts }): string => `${status} ${String(attempts.length)}`),
    ['parse_error 1', 'parse_error 2'],
  );
});
