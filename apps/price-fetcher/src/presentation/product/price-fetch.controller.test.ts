import assert from 'node:assert/strict';
import { test } from 'node:test';

import { silentLogger } from 'logger';
import { OzonReferenceParser, ResolveProductReferenceUseCase } from 'product-reference';
import type { PriceFetchResultType } from 'queue-contract';
import { JobLifecycleReporter, QueueMessageParser } from 'queue-worker';

import { FetchPricesUseCase } from '../../application/product/fetch-prices.use-case.js';
import type { ProductBatchReaderPort } from '../../application/product/product-batch-reader.port.js';
import type { ProductReaderPort } from '../../application/product/product-reader.port.js';
import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import { PriceFetchController } from './price-fetch.controller.js';

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

const jobId = '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11';
const productId = '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33';
const invalidProductId = '1c7f2a90-34b1-4c4f-8f55-5a5f6f1e2e44';
const job = {
  jobId,
  proxies: [{ server: 'socks5://217.71.230.103:1080' }, { server: 'socks5://127.0.0.1:1080' }],
  products: [
    { trackedProductId: productId, url: 'https://www.ozon.ru/product/4775581891/' },
    { trackedProductId: invalidProductId, url: 'https://example.com/item/1' },
  ],
  timeoutMs: 15000,
};
const success: ReadProductResultType = {
  status: 'success',
  snapshot: {
    title: 'Notebook',
    observedAt: '2026-10-24T12:00:00.000Z',
    prices: [{ amountMinor: 10000000, currency: 'RUB' }],
    availability: 'in_stock',
    imageUrl: null,
  },
  exitIp: '217.71.230.103',
};

function createController(
  published: PriceFetchResultType[],
  result: ReadProductResultType | ((url: string) => ReadProductResultType) = success,
): PriceFetchController {
  const publish = (message: PriceFetchResultType): Promise<void> => {
    published.push(message);

    return Promise.resolve();
  };

  return new PriceFetchController(
    new FetchPricesUseCase(
      new ResolveProductReferenceUseCase([new OzonReferenceParser()]),
      (): ProductBatchReaderPort =>
        oneByOne({
          read: (reference): Promise<ReadProductResultType> =>
            Promise.resolve(typeof result === 'function' ? result(reference.url) : result),
        }),
    ),
    new QueueMessageParser(silentLogger),
    new JobLifecycleReporter(publish, silentLogger),
    publish,
  );
}

function isType<TypeName extends PriceFetchResultType['type']>(
  type: TypeName,
): (message: PriceFetchResultType) => message is Extract<PriceFetchResultType, { type: TypeName }> {
  return (message): message is Extract<PriceFetchResultType, { type: TypeName }> =>
    message.type === type;
}

void test('reads products through the given routes and reports progress and completion', async (): Promise<void> => {
  const published: PriceFetchResultType[] = [];
  await createController(published).handle(job, new AbortController().signal);

  assert.deepEqual(
    published.map((message): string => message.type),
    [
      'job_started',
      'job_progress',
      'product_result',
      'job_progress',
      'product_result',
      'job_progress',
      'job_done',
    ],
  );
  assert.deepEqual(
    published
      .filter(isType('job_progress'))
      .map((progress): number[] => [progress.processed, progress.total, progress.succeeded]),
    [
      [0, 2, 0],
      [1, 2, 0],
      [2, 2, 1],
    ],
  );

  // A link that is not of a product is told of before the products are read.
  const [first, second] = published.filter(isType('product_result'));
  assert.equal(first?.status, 'invalid_url');
  assert.deepEqual(
    { ...second, attempts: second?.attempts.map(({ proxy, result }) => ({ proxy, result })) },
    {
      type: 'product_result',
      jobId,
      trackedProductId: productId,
      status: 'success',
      attempts: [{ proxy: 'socks5://217.71.230.103:1080', result: success }],
    },
  );
});

void test('reports no proxies when every route is unsafe', async (): Promise<void> => {
  const published: PriceFetchResultType[] = [];
  await createController(published).handle(
    {
      ...job,
      proxies: [{ server: 'socks5://127.0.0.1:1080' }],
      products: [job.products[0]],
    },
    new AbortController().signal,
  );

  const [first] = published.filter(isType('product_result'));
  assert.equal(first?.status, 'no_proxies');
});

void test('reports a failed job and tells whether it is retried', async (): Promise<void> => {
  const published: PriceFetchResultType[] = [];
  const abort = new AbortController();
  abort.abort();

  await assert.rejects(createController(published).handle(job, abort.signal, true));

  const [failure] = published.filter(isType('job_failed'));
  assert.equal(failure?.willRetry, true);
  assert.equal(published.some(isType('job_done')), false);
});

const secondProductId = '5d8b0a51-6e0e-4f69-9b36-3f4f0a8f2c55';
const secondUrl = 'https://www.ozon.ru/product/1168909010/';
const twoProducts = [job.products[0], { trackedProductId: secondProductId, url: secondUrl }];
const readOnlyFirst = (url: string): ReadProductResultType =>
  url === secondUrl ? { status: 'network_error' } : success;

void test('fails the job when no product could be read, so that the queue brings it back later', async (): Promise<void> => {
  for (const status of ['network_error', 'http_error', 'challenge_required'] as const) {
    const published: PriceFetchResultType[] = [];

    await assert.rejects(
      createController(published, { status }).handle(
        { ...job, products: [job.products[0]] },
        new AbortController().signal,
        true,
      ),
      /could not be read/,
    );

    assert.equal(published.find(isType('job_failed'))?.willRetry, true, status);
    assert.equal(published.find(isType('product_result'))?.status, status);
  }
});

void test('marks the products that were read, so that the next try leaves them alone', async (): Promise<void> => {
  const published: PriceFetchResultType[] = [];
  const next: unknown[] = [];

  await assert.rejects(
    createController(published, readOnlyFirst).handle(
      { ...job, products: twoProducts },
      new AbortController().signal,
      true,
      (data): Promise<void> => {
        next.push(data);

        return Promise.resolve();
      },
    ),
  );

  assert.deepEqual(next, [
    {
      ...job,
      products: [{ ...twoProducts[0], read: true }, twoProducts[1]],
    },
  ]);
});

void test('does not read again a product that is marked as read, and counts it as done', async (): Promise<void> => {
  const published: PriceFetchResultType[] = [];
  const asked: string[] = [];

  await createController(published, (url) => {
    asked.push(url);

    return success;
  }).handle(
    { ...job, products: [{ ...twoProducts[0], read: true }, twoProducts[1]] },
    new AbortController().signal,
  );

  assert.deepEqual(asked, [secondUrl]);
  assert.deepEqual(
    published.filter(isType('product_result')).map(({ trackedProductId }) => trackedProductId),
    [secondProductId],
  );
  assert.deepEqual(
    published
      .filter(isType('job_progress'))
      .map((progress): number[] => [progress.processed, progress.total, progress.succeeded]),
    [
      [1, 2, 1],
      [2, 2, 2],
    ],
  );
});

void test('fails the job on the last try when a product is still unread, keeping what was read', async (): Promise<void> => {
  const published: PriceFetchResultType[] = [];

  await assert.rejects(
    createController(published, readOnlyFirst).handle(
      { ...job, products: twoProducts },
      new AbortController().signal,
      false,
    ),
    /1 products could not be read/,
  );

  assert.equal(published.find(isType('job_failed'))?.willRetry, false);
  assert.deepEqual(
    published.filter(isType('product_result')).map(({ status }) => status),
    ['success', 'network_error'],
  );
});

void test('fails the job on the last try when nothing was read', async (): Promise<void> => {
  const published: PriceFetchResultType[] = [];

  await assert.rejects(
    createController(published, { status: 'network_error' }).handle(
      { ...job, products: twoProducts },
      new AbortController().signal,
      false,
    ),
  );
  assert.equal(published.find(isType('job_failed'))?.willRetry, false);
});

void test('does not fail the job over links that are no products', async (): Promise<void> => {
  const published: PriceFetchResultType[] = [];

  await createController(published).handle(
    { ...job, products: [job.products[1]] },
    new AbortController().signal,
  );

  assert.equal(published.some(isType('job_done')), true);
});

void test('rejects a malformed job', async (): Promise<void> => {
  await assert.rejects(
    createController([]).handle({ jobId: 'nope' }, new AbortController().signal),
    { name: 'UnrecoverableError' },
  );
});

void test('starts the next try on the routes that did not fail this one', async (): Promise<void> => {
  const dead = 'socks5://217.71.230.1:1080';
  const refused = 'socks5://217.71.230.2:1080';
  const untried = 'socks5://217.71.230.3:1080';
  const answers: Readonly<Record<string, ReadProductResultType>> = {
    [dead]: { status: 'network_error' },
    [refused]: { status: 'challenge_required' },
  };
  const publish = (): Promise<void> => Promise.resolve();
  const controller = new PriceFetchController(
    new FetchPricesUseCase(
      new ResolveProductReferenceUseCase([new OzonReferenceParser()]),
      (): ProductBatchReaderPort =>
        oneByOne({
          read: (_reference, endpoint): Promise<ReadProductResultType> =>
            Promise.resolve(answers[endpoint.server] ?? success),
        }),
    ),
    new QueueMessageParser(silentLogger),
    new JobLifecycleReporter(publish, silentLogger),
    publish,
  );
  const next: unknown[] = [];

  await assert.rejects(
    controller.handle(
      {
        ...job,
        proxies: [{ server: dead }, { server: refused }, { server: untried }],
        products: [job.products[0]],
      },
      new AbortController().signal,
      true,
      (data): Promise<void> => {
        next.push(data);

        return Promise.resolve();
      },
    ),
  );

  assert.deepEqual(next, [
    {
      ...job,
      proxies: [{ server: untried }, { server: dead }, { server: refused }],
      products: [job.products[0]],
    },
  ]);
});
