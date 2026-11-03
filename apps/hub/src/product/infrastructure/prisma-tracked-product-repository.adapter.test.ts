import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';
import { ProductGoneError } from '../application/product-gone.error.js';
import type { TrackedProductReferenceInterface } from '../application/tracked-product-repository.port.js';
import { PrismaTrackedProductRepositoryAdapter } from './prisma-tracked-product-repository.adapter.js';

/** Needs a Postgres with the migrations applied: set TEST_DATABASE_URL to run it (never a database with data that matters). */
const url = process.env['TEST_DATABASE_URL'];
const skip = url === undefined ? 'TEST_DATABASE_URL is not set' : false;

let prisma: PrismaClient;
let products: PrismaTrackedProductRepositoryAdapter;
let jane: string;
let sam: string;

before(async (): Promise<void> => {
  if (url === undefined) return;

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 20 }) });
  products = new PrismaTrackedProductRepositoryAdapter(prisma);
  [jane, sam] = [randomUUID(), randomUUID()];
  for (const id of [jane, sam]) {
    await prisma.user.create({ data: { id, email: `${id}@example.com` } });
  }
});

after(async (): Promise<void> => {
  if (url === undefined) return;

  await prisma.user.deleteMany({ where: { id: { in: [jane, sam] } } });
  await prisma.$disconnect();
});

async function newProduct(): Promise<string> {
  const externalId = randomUUID();
  const { product } = await products.add({
    marketplace: 'ozon',
    externalId,
    url: `https://www.ozon.ru/product/${externalId}/`,
    cityId: null,
    cityName: null,
  });

  return product.snapshot.id;
}

void test(
  'tracks a product once per user, and lists the products of a user, the newest subscription first',
  { skip },
  async (): Promise<void> => {
    const [first, second] = [await newProduct(), await newProduct()];

    assert.equal(await products.subscribe(jane, first), true);
    assert.equal(await products.subscribe(jane, first), false);
    await new Promise((resolve): void => {
      setTimeout(resolve, 20);
    });
    assert.equal(await products.subscribe(jane, second), true);
    assert.equal(await products.subscribe(sam, first), true);

    const own = await products.listSubscribed(jane, { page: 1, pageSize: 100 });
    assert.deepEqual(own.items.map((product): string => product.snapshot.id).slice(0, 2), [
      second,
      first,
    ]);
    assert.notEqual(await products.findSubscribed(sam, first), null);
    assert.equal(await products.findSubscribed(sam, second), null);

    for (const id of [first, second]) await prisma.trackedProduct.delete({ where: { id } });
  },
);

void test(
  'deletes a product with its last tracker, and not before',
  { skip },
  async (): Promise<void> => {
    const id = await newProduct();
    await products.subscribe(jane, id);
    await products.subscribe(sam, id);

    assert.equal(await products.unsubscribe(jane, id), true);
    assert.equal(await products.unsubscribe(jane, id), false);
    assert.notEqual(await products.findById(id), null);

    assert.equal(await products.unsubscribe(sam, id), true);
    assert.equal(await products.findById(id), null);
  },
);

void test(
  'while the last tracker leaves, a user who joins ends up either on the kept product or told it is gone',
  { skip },
  async (): Promise<void> => {
    for (let round = 0; round < 25; round += 1) {
      const id = await newProduct();
      await products.subscribe(jane, id);

      const [removed, joined] = await Promise.all([
        products.unsubscribe(jane, id),
        products.subscribe(sam, id).then(
          (): string => 'joined',
          (error: unknown): string => (error instanceof ProductGoneError ? 'gone' : 'broken'),
        ),
      ]);

      assert.equal(removed, true);
      assert.notEqual(joined, 'broken');
      const kept = await products.findById(id);
      assert.equal(kept !== null, joined === 'joined');
      // Whichever way it fell, no product is left that nobody tracks, and nobody tracks a missing one.
      assert.equal(
        await prisma.trackedProduct.count({ where: { id, subscriptions: { none: {} } } }),
        0,
      );
      if (kept !== null) await prisma.trackedProduct.delete({ where: { id } });
    }
  },
);

void test(
  'lists the tracked products whose last read and request are both before a time, the longest waiting first',
  { skip },
  async (): Promise<void> => {
    const [fresh, waiting, never, untracked] = [
      await newProduct(),
      await newProduct(),
      await newProduct(),
      await newProduct(),
    ];
    for (const id of [fresh, waiting, never]) await products.subscribe(jane, id);
    const before = new Date('2026-10-31T10:00:00Z');
    await products.markChecked(waiting, 'ok', new Date(before.getTime() - 3_600_000));
    await products.markRequested([fresh], new Date(before.getTime() + 60_000));
    await products.markChecked(fresh, 'ok', new Date(before.getTime() - 7_200_000));

    const due = (await products.listDueForRefresh(before, 1000)).map(
      (product): string => product.snapshot.id,
    );

    assert.ok(due.includes(never));
    assert.ok(due.includes(waiting));
    assert.equal(due.includes(fresh), false);
    assert.equal(due.includes(untracked), false);
    assert.ok(due.indexOf(never) < due.indexOf(waiting));

    await products.markRequested([never, waiting], new Date(before.getTime() + 1000));
    const after = (await products.listDueForRefresh(before, 1000)).map(
      (product): string => product.snapshot.id,
    );
    assert.equal(after.includes(never) || after.includes(waiting), false);

    for (const id of [fresh, waiting, never, untracked]) {
      await prisma.trackedProduct.delete({ where: { id } });
    }
  },
);

void test(
  'keeps one product per city, and one for a marketplace without cities, whatever is asked',
  { skip },
  async (): Promise<void> => {
    const externalId = randomUUID().replaceAll('-', '').slice(0, 16);
    const reference = (cityId: string | null): TrackedProductReferenceInterface => ({
      marketplace: 'dns',
      externalId,
      url: `https://www.dns-shop.ru/product/${externalId}/`,
      cityId,
      cityName: cityId === null ? null : 'Город',
    });

    const moscow = await products.add(reference('city-moscow'));
    const irkutsk = await products.add(reference('city-irkutsk'));
    const again = await products.add(reference('city-irkutsk'));
    const none = await products.add(reference(null));
    const noneAgain = await products.add(reference(null));

    assert.deepEqual([moscow.created, irkutsk.created, again.created], [true, true, false]);
    assert.equal(again.product.snapshot.id, irkutsk.product.snapshot.id);
    assert.notEqual(moscow.product.snapshot.id, irkutsk.product.snapshot.id);
    assert.equal(irkutsk.product.snapshot.cityId, 'city-irkutsk');
    assert.equal(none.product.snapshot.cityId, null);
    assert.equal(noneAgain.product.snapshot.id, none.product.snapshot.id);

    await prisma.trackedProduct.deleteMany({ where: { externalId } });
  },
);

void test(
  'pages through products subscribed at the same moment without repeating or skipping one',
  { skip },
  async (): Promise<void> => {
    const user = randomUUID();
    await prisma.user.create({ data: { id: user, email: `${user}@example.com` } });
    try {
      const ids = [await newProduct(), await newProduct(), await newProduct(), await newProduct()];
      const at = new Date('2026-11-01T10:00:00Z');
      await prisma.productSubscription.createMany({
        data: ids.map(
          (trackedProductId): { userId: string; trackedProductId: string; createdAt: Date } => ({
            userId: user,
            trackedProductId,
            createdAt: at,
          }),
        ),
      });

      const pages = await Promise.all(
        [1, 2].map((page) => products.listSubscribed(user, { page, pageSize: 2 })),
      );

      const listed = pages.flatMap((page): string[] =>
        page.items.map((product): string => product.snapshot.id),
      );
      assert.deepEqual(listed.toSorted(), ids.toSorted());
    } finally {
      await prisma.user.deleteMany({ where: { id: user } });
    }
  },
);

void test(
  'finds the product of an item tracked in a city by any of the ids given, the one tracked first',
  { skip },
  async (): Promise<void> => {
    const externalId = randomUUID();
    const inCity = (cityId: string): TrackedProductReferenceInterface => ({
      marketplace: 'wildberries',
      externalId,
      url: `https://www.wildberries.ru/catalog/${externalId}/detail.aspx`,
      cityId,
      cityName: 'Санкт-Петербург',
    });
    const first = (await products.add(inCity('-1205339'))).product.snapshot.id;
    const second = (await products.add(inCity('-1198680'))).product.snapshot.id;

    assert.equal(
      (await products.findInCities('wildberries', externalId, ['-1198680', '-1205339']))?.snapshot
        .id,
      first,
    );
    assert.equal(
      (await products.findInCities('wildberries', externalId, ['-1198680']))?.snapshot.id,
      second,
    );
    assert.equal(await products.findInCities('wildberries', externalId, ['-1']), null);
    assert.equal(await products.findInCities('ozon', externalId, ['-1205339']), null);

    await prisma.trackedProduct.deleteMany({ where: { id: { in: [first, second] } } });
  },
);
