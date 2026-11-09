import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import type { MarketplaceType } from 'product-reference';

import type { ClockPort } from '../../shared/application/clock.port.js';
import { InMemoryPriceObservationRepositoryAdapter } from '../infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryProductGroupRepositoryAdapter } from '../infrastructure/in-memory-product-group-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import { GetProductStatsUseCase } from './get-product-stats.use-case.js';

const hour = 3_600_000;
const now = new Date('2026-10-31T12:30:00Z');
const clock: ClockPort = { now: (): Date => now };
const ago = (hours: number): Date => new Date(now.getTime() - hours * hour);

void test('counts the products, the trackings and the groups, and how the prices of each marketplace are read', async (): Promise<void> => {
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const groups = new InMemoryProductGroupRepositoryAdapter();
  const observations = new InMemoryPriceObservationRepositoryAdapter();
  const track = async (marketplace: MarketplaceType, n: number): Promise<string> => {
    const { product } = await products.add({
      marketplace,
      externalId: String(n),
      url: `https://example.com/${String(n)}`,
      cityId: null,
      cityName: null,
    });
    await products.subscribe('jane', product.snapshot.id);

    return product.snapshot.id;
  };
  const read = async (trackedProductId: string, observedAt: Date): Promise<void> => {
    await observations.saveIfAbsent({
      id: randomUUID(),
      trackedProductId,
      jobId: randomUUID(),
      title: 'Phone',
      observedAt,
      availability: 'in_stock',
      prices: [{ amountMinor: 100, currency: 'RUB' }],
      exitIp: null,
    });
  };

  const fresh = await track('ozon', 1);
  const stale = await track('ozon', 2);
  await track('ozon', 3);
  const dns = await track('dns', 4);
  await products.subscribe('sam', fresh);
  await groups.create('jane', null);
  await read(fresh, ago(30));
  await read(fresh, ago(1));
  await read(fresh, ago(0.5));
  await read(stale, ago(5));
  await read(dns, ago(1));

  const stats = await new GetProductStatsUseCase(products, groups, observations, clock).execute();

  assert.deepEqual(
    { products: stats.products, trackings: stats.trackings, groups: stats.groups },
    { products: 4, trackings: 5, groups: 1 },
  );
  assert.deepEqual(
    stats.marketplaces.filter(({ products: count }): boolean => count > 0),
    [
      {
        marketplace: 'ozon',
        products: 3,
        readsLastDay: 3,
        lastReadAt: ago(0.5),
        stale: 1,
        unread: 1,
      },
      { marketplace: 'dns', products: 1, readsLastDay: 1, lastReadAt: ago(1), stale: 0, unread: 0 },
    ],
  );
  assert.deepEqual(stats.readsByHour, [
    { hour: new Date('2026-10-31T07:00:00Z'), marketplace: 'ozon', reads: 1 },
    { hour: new Date('2026-10-31T11:00:00Z'), marketplace: 'ozon', reads: 1 },
    { hour: new Date('2026-10-31T11:00:00Z'), marketplace: 'dns', reads: 1 },
    { hour: new Date('2026-10-31T12:00:00Z'), marketplace: 'ozon', reads: 1 },
  ]);
});
