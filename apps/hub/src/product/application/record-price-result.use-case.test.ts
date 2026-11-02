import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryPriceObservationRepositoryAdapter } from '../infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import { noThumbnails } from './add-product-defaults.type.js';
import { ListPriceHistoryUseCase } from './list-price-history.use-case.js';
import { ProductNotFoundError } from './product-not-found.error.js';
import {
  type PriceResultInterface,
  RecordPriceResultUseCase,
} from './record-price-result.use-case.js';

const jobId = '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11';

const userId = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';

async function setup(): Promise<{
  productId: string;
  record: RecordPriceResultUseCase;
  history: ListPriceHistoryUseCase;
  products: InMemoryTrackedProductRepositoryAdapter;
}> {
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const observations = new InMemoryPriceObservationRepositoryAdapter();
  const { product } = await products.add({
    marketplace: 'ozon',
    externalId: '1',
    url: 'https://www.ozon.ru/product/1/',
    cityId: null,
    cityName: null,
  });
  await products.subscribe(userId, product.snapshot.id);

  return {
    productId: product.snapshot.id,
    record: new RecordPriceResultUseCase(products, observations, noThumbnails),
    history: new ListPriceHistoryUseCase(products, observations),
    products,
  };
}

function result(productId: string, overrides: Partial<PriceResultInterface>): PriceResultInterface {
  return {
    jobId,
    trackedProductId: productId,
    status: 'success',
    observation: {
      title: 'Notebook',
      observedAt: new Date('2026-10-24T12:00:00.000Z'),
      availability: 'in_stock',
      prices: [{ amountMinor: 10000000, currency: 'RUB' }],
      exitIp: '217.71.230.103',
    },
    ...overrides,
  };
}

void test('records an observation once even if the result is delivered twice', async (): Promise<void> => {
  const { productId, record, history, products } = await setup();

  await record.execute(result(productId, {}));
  await record.execute(result(productId, {}));

  const { product, page } = await history.execute(userId, productId, { page: 1, pageSize: 10 });
  assert.equal(product.snapshot.url, 'https://www.ozon.ru/product/1/');
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.prices.length, 1);
  assert.equal((await products.findById(productId))?.snapshot.lastStatus, 'success');
});

void test('keeps failures out of the price history but remembers the status', async (): Promise<void> => {
  const { productId, record, history, products } = await setup();

  await record.execute(result(productId, { status: 'challenge_required', observation: null }));

  assert.equal((await history.execute(userId, productId, { page: 1, pageSize: 10 })).page.total, 0);
  assert.equal((await products.findById(productId))?.snapshot.lastStatus, 'challenge_required');
});

void test('ignores a result of an unknown product and rejects its history', async (): Promise<void> => {
  const { record, history } = await setup();
  const unknown = '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33';

  await record.execute(result(unknown, {}));
  await assert.rejects(
    history.execute(userId, unknown, { page: 1, pageSize: 10 }),
    ProductNotFoundError,
  );
});

void test('paginates the history, the newest first', async (): Promise<void> => {
  const { productId, record, history } = await setup();

  for (const [index, observedAt] of [
    '2026-10-22T12:00:00.000Z',
    '2026-10-24T12:00:00.000Z',
    '2026-10-23T12:00:00.000Z',
  ].entries()) {
    const base = result(productId, {});
    await record.execute({
      ...base,
      jobId: `3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a1${String(index)}`,
      observation: base.observation && { ...base.observation, observedAt: new Date(observedAt) },
    });
  }

  const first = (await history.execute(userId, productId, { page: 1, pageSize: 2 })).page;
  const second = (await history.execute(userId, productId, { page: 2, pageSize: 2 })).page;

  assert.equal(first.total, 3);
  assert.deepEqual(
    first.items.map((item): string => item.observedAt.toISOString()),
    ['2026-10-24T12:00:00.000Z', '2026-10-23T12:00:00.000Z'],
  );
  assert.deepEqual(
    second.items.map((item): string => item.observedAt.toISOString()),
    ['2026-10-22T12:00:00.000Z'],
  );
});

void test('hands the picture of the product over once the price is recorded, and none when there is none', async (): Promise<void> => {
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const observations = new InMemoryPriceObservationRepositoryAdapter();
  const { product } = await products.add({
    marketplace: 'ozon',
    externalId: '1',
    url: 'https://www.ozon.ru/product/1/',
    cityId: null,
    cityName: null,
  });
  const order: string[] = [];
  const record = new RecordPriceResultUseCase(
    products,
    {
      saveIfAbsent: (observation): Promise<void> => {
        order.push('price');

        return observations.saveIfAbsent(observation);
      },
      findLatestByProducts: (ids): ReturnType<typeof observations.findLatestByProducts> =>
        observations.findLatestByProducts(ids),
      listSince: (ids, since): ReturnType<typeof observations.listSince> =>
        observations.listSince(ids, since),
      listByProduct: (id, pagination): ReturnType<typeof observations.listByProduct> =>
        observations.listByProduct(id, pagination),
    },
    {
      execute: (productId, imageUrl): Promise<void> => {
        assert.equal(productId, product.snapshot.id);
        order.push(`picture ${String(imageUrl)}`);

        return Promise.resolve();
      },
    },
  );

  await record.execute(result(product.snapshot.id, { imageUrl: 'https://cdn.example/a.jpg' }));
  await record.execute(result(product.snapshot.id, { jobId: 'another-job' }));

  assert.deepEqual(order, ['price', 'picture https://cdn.example/a.jpg', 'price', 'picture null']);
});
