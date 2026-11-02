import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaProductGroupPreferenceRepositoryAdapter } from './prisma-product-group-preference-repository.adapter.js';
import { PrismaProductGroupRepositoryAdapter } from './prisma-product-group-repository.adapter.js';
import { PrismaTrackedProductRepositoryAdapter } from './prisma-tracked-product-repository.adapter.js';

/** Needs a Postgres with the migrations applied: set TEST_DATABASE_URL to run it (never a database with data that matters). */
const url = process.env['TEST_DATABASE_URL'];
const skip = url === undefined ? 'TEST_DATABASE_URL is not set' : false;

let prisma: PrismaClient;
let groups: PrismaProductGroupRepositoryAdapter;
let products: PrismaTrackedProductRepositoryAdapter;
let jane: string;
let sam: string;

before(async (): Promise<void> => {
  if (url === undefined) return;

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 20 }) });
  groups = new PrismaProductGroupRepositoryAdapter(prisma);
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

async function trackedBy(userId: string): Promise<string> {
  const externalId = randomUUID();
  const { product } = await products.add({
    marketplace: 'ozon',
    externalId,
    url: `https://www.ozon.ru/product/${externalId}/`,
    cityId: null,
    cityName: null,
  });
  await products.subscribe(userId, product.snapshot.id);

  return product.snapshot.id;
}

void test(
  'a product is in one group of the user, which keeps it in the order of adding',
  { skip },
  async (): Promise<void> => {
    const [first, second] = [await groups.create(jane, null), await groups.create(jane, 'Phone')];
    const [a, b] = [await trackedBy(jane), await trackedBy(jane)];

    await groups.place(jane, first.snapshot.id, a);
    await groups.place(jane, first.snapshot.id, b);
    await groups.place(jane, second.snapshot.id, a);

    assert.equal(await groups.findGroupIdOfProduct(jane, a), first.snapshot.id);
    assert.deepEqual(
      (await groups.listProductIds([first.snapshot.id, second.snapshot.id])).map(
        ({ productId }): string => productId,
      ),
      [a, b],
    );
  },
);

void test(
  'a group belongs to its user: the others neither see nor rename nor delete it',
  { skip },
  async (): Promise<void> => {
    const group = await groups.create(jane, null);

    assert.equal(await groups.findOwned(sam, group.snapshot.id), null);
    assert.equal(await groups.rename(sam, group.snapshot.id, 'mine'), false);
    assert.equal(await groups.delete(sam, group.snapshot.id), false);
    assert.equal(await groups.rename(jane, group.snapshot.id, 'Phone'), true);
    assert.equal((await groups.findOwned(jane, group.snapshot.id))?.snapshot.title, 'Phone');
    assert.equal(await groups.delete(jane, group.snapshot.id), true);
  },
);

void test(
  'a product leaves its group when the user stops tracking it',
  { skip },
  async (): Promise<void> => {
    const group = await groups.create(jane, null);
    const productId = await trackedBy(jane);
    await groups.place(jane, group.snapshot.id, productId);

    await products.unsubscribe(jane, productId);

    assert.equal(await groups.findGroupIdOfProduct(jane, productId), null);
    assert.deepEqual(await groups.listProductIds([group.snapshot.id]), []);
  },
);

void test(
  'lists the groups of a user, the newest first, a page at a time',
  { skip },
  async (): Promise<void> => {
    const user = randomUUID();
    await prisma.user.create({ data: { id: user, email: `${user}@example.com` } });
    const created = [];
    for (const title of ['a', 'b', 'c']) {
      created.push(await groups.create(user, title));
      await new Promise((resolve): void => {
        setTimeout(resolve, 5);
      });
    }

    const page = await groups.listOwned(user, { page: 1, pageSize: 2 });

    assert.equal(page.total, 3);
    assert.deepEqual(
      page.items.map(({ snapshot }) => snapshot.title),
      ['c', 'b'],
    );
    await prisma.user.delete({ where: { id: user } });
  },
);

void test(
  'remembers the period the user chose, the default one before',
  { skip },
  async (): Promise<void> => {
    const preferences = new PrismaProductGroupPreferenceRepositoryAdapter(prisma);

    assert.equal(await preferences.getStatsPeriod(jane), '24h');
    await preferences.setStatsPeriod(jane, '7d');
    await preferences.setStatsPeriod(jane, '30d');

    assert.equal(await preferences.getStatsPeriod(jane), '30d');
    assert.equal(await preferences.getStatsPeriod(sam), '24h');
  },
);
