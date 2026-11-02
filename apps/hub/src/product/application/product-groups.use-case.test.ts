import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryPriceObservationRepositoryAdapter } from '../infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryProductGroupPreferenceRepositoryAdapter } from '../infrastructure/in-memory-product-group-preference-repository.adapter.js';
import { InMemoryProductGroupRepositoryAdapter } from '../infrastructure/in-memory-product-group-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import { DescribeProductGroupsUseCase } from './describe-product-groups.use-case.js';
import { GetProductGroupUseCase } from './get-product-group.use-case.js';
import { ListProductGroupsUseCase } from './list-product-groups.use-case.js';
import { ProductGroupNotFoundError } from './product-group-not-found.error.js';
import { RemoveProductGroupUseCase } from './remove-product-group.use-case.js';
import { RenameProductGroupUseCase } from './rename-product-group.use-case.js';
import { SetStatsPeriodUseCase } from './set-stats-period.use-case.js';

const jane = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';
const sam = '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33';
const now = new Date('2026-11-02T12:00:00Z');
const hoursAgo = (hours: number): Date => new Date(now.getTime() - hours * 3_600_000);
const firstPage = { page: 1, pageSize: 10 };

function setup(): {
  groups: InMemoryProductGroupRepositoryAdapter;
  products: InMemoryTrackedProductRepositoryAdapter;
  observations: InMemoryPriceObservationRepositoryAdapter;
  preferences: InMemoryProductGroupPreferenceRepositoryAdapter;
  describe: DescribeProductGroupsUseCase;
  list: ListProductGroupsUseCase;
} {
  const groups = new InMemoryProductGroupRepositoryAdapter();
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const observations = new InMemoryPriceObservationRepositoryAdapter();
  const preferences = new InMemoryProductGroupPreferenceRepositoryAdapter();
  const describe = new DescribeProductGroupsUseCase(groups, products, observations, {
    now: (): Date => now,
  });

  return {
    groups,
    products,
    observations,
    preferences,
    describe,
    list: new ListProductGroupsUseCase(groups, preferences, describe),
  };
}

/** A product of the user in the group, with the prices it was read at: `[hours ago, price]`. */
async function track(
  { groups, products, observations }: ReturnType<typeof setup>,
  groupId: string,
  marketplace: 'ozon' | 'dns',
  title: string,
  reads: Array<[number, number]>,
): Promise<string> {
  const { product } = await products.add({
    marketplace,
    externalId: `${marketplace}-${title}`,
    url: `https://${marketplace}.example/${title}`,
    cityId: null,
    cityName: null,
  });
  const id = product.snapshot.id;
  await products.subscribe(jane, id);
  await groups.place(jane, groupId, id);
  for (const [hours, amountMinor] of reads) {
    await observations.saveIfAbsent({
      id: `${id}-${String(hours)}`,
      trackedProductId: id,
      jobId: `${id}-${String(hours)}`,
      title,
      observedAt: hoursAgo(hours),
      availability: 'in_stock',
      prices: [{ amountMinor, currency: 'RUB' }],
      exitIp: null,
    });
  }

  return id;
}

void test('a group is called after its first product until the user names it', async (): Promise<void> => {
  const env = setup();
  const group = await env.groups.create(jane, null);
  await track(env, group.snapshot.id, 'ozon', 'Phone X', [[1, 1000]]);
  await track(env, group.snapshot.id, 'dns', 'Phone X 128', [[1, 900]]);

  const [unnamed] = await env.describe.execute([group], '24h');
  assert.equal(unnamed?.title, 'Phone X');

  await new RenameProductGroupUseCase(env.groups).execute(jane, group.snapshot.id, 'My phone');
  const named = await new GetProductGroupUseCase(env.groups, env.preferences, env.describe).execute(
    jane,
    group.snapshot.id,
  );
  assert.equal(named.title, 'My phone');
  assert.deepEqual(
    named.products.map(({ product }) => product.snapshot.marketplace),
    ['ozon', 'dns'],
  );
});

void test('the card shows the best current price and the period the user chose', async (): Promise<void> => {
  const env = setup();
  const group = await env.groups.create(jane, null);
  await track(env, group.snapshot.id, 'ozon', 'Phone', [
    [100, 800],
    [10, 1200],
    [1, 1000],
  ]);
  await track(env, group.snapshot.id, 'dns', 'Phone', [
    [10, 1100],
    [1, 950],
  ]);

  const day = await env.list.execute(jane, firstPage);
  assert.equal(day.statsPeriod, '24h');
  assert.equal(day.items[0]?.prices.current?.marketplace, 'dns');
  assert.equal(day.items[0].prices.min?.amountMinor, 1100);

  await new SetStatsPeriodUseCase(env.preferences).execute(jane, '30d');
  const month = await env.list.execute(jane, firstPage);
  assert.equal(month.statsPeriod, '30d');
  assert.equal(month.items[0]?.prices.min?.amountMinor, 800);
  assert.equal(month.items[0].prices.highlighted, false);
});

void test('a user sees their own groups only, the newest first', async (): Promise<void> => {
  const { groups, list } = setup();
  const older = await groups.create(jane, 'older');
  const newer = await groups.create(jane, 'newer');
  await groups.create(sam, 'sam');

  const page = await list.execute(jane, firstPage);

  assert.deepEqual(
    page.items.map(({ group }) => group.snapshot.id),
    [newer.snapshot.id, older.snapshot.id],
  );
  assert.equal(page.total, 2);
});

void test("deleting a group stops tracking its products and others' groups are not reachable", async (): Promise<void> => {
  const env = setup();
  const group = await env.groups.create(jane, null);
  const productId = await track(env, group.snapshot.id, 'ozon', 'Phone', [[1, 1000]]);
  const removed: string[] = [];
  const remove = new RemoveProductGroupUseCase(env.groups, {
    execute: (userId, id): Promise<void> => {
      removed.push(`${userId}:${id}`);

      return Promise.resolve();
    },
  });

  await assert.rejects(remove.execute(sam, group.snapshot.id), ProductGroupNotFoundError);
  assert.deepEqual(removed, []);

  await remove.execute(jane, group.snapshot.id);

  assert.deepEqual(removed, [`${jane}:${productId}`]);
  assert.equal(await env.groups.findOwned(jane, group.snapshot.id), null);
  await assert.rejects(
    new RenameProductGroupUseCase(env.groups).execute(jane, group.snapshot.id, 'x'),
    ProductGroupNotFoundError,
  );
});
