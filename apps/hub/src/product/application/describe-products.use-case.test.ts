import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryPriceObservationRepositoryAdapter } from '../infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import { DescribeProductsUseCase } from './describe-products.use-case.js';

void test('names the products by their ids with the title of the newest read, and leaves out what is no product', async (): Promise<void> => {
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const observations = new InMemoryPriceObservationRepositoryAdapter();
  const { product } = await products.add({
    marketplace: 'dns',
    externalId: '1',
    url: 'https://www.dns-shop.ru/product/1/',
    cityId: 'irk',
    cityName: 'Иркутск',
  });
  const { id } = product.snapshot;
  await observations.saveIfAbsent({
    id: '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11',
    trackedProductId: id,
    jobId: '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a12',
    title: 'Phone',
    observedAt: new Date('2026-10-31T12:00:00Z'),
    availability: 'in_stock',
    prices: [],
    exitIp: null,
  });

  const described = await new DescribeProductsUseCase(products, observations).execute([
    id,
    id,
    'wildberries',
    '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33',
  ]);

  assert.deepEqual(described, [
    {
      id,
      marketplace: 'dns',
      url: 'https://www.dns-shop.ru/product/1/',
      cityName: 'Иркутск',
      title: 'Phone',
    },
  ]);
});
