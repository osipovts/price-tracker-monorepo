import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DnsReferenceParser,
  marketplaceDefaultCities,
  OzonReferenceParser,
  ResolveProductReferenceUseCase,
  WildberriesReferenceParser,
} from 'product-reference';

import { NoProxiesAvailableError } from '../../shared/application/no-proxies-available.error.js';
import { TooManyRequestsError } from '../../shared/application/too-many-requests.error.js';
import { InMemoryRateLimiterAdapter } from '../../shared/infrastructure/in-memory-rate-limiter.adapter.js';
import { InMemoryPriceObservationRepositoryAdapter } from '../infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryProductGroupRepositoryAdapter } from '../infrastructure/in-memory-product-group-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import { AddProductUseCase } from './add-product.use-case.js';
import { ListPriceHistoryUseCase } from './list-price-history.use-case.js';
import type { KnownCityInterface, MarketplaceCitiesPort } from './marketplace-cities.port.js';
import { ProductAddingInProgressError } from './product-adding-in-progress.error.js';
import { ProductGroupFullError } from './product-group-full.error.js';
import { ProductGroupNotFoundError } from './product-group-not-found.error.js';
import { ProductNotFoundError } from './product-not-found.error.js';
import type { ProductLimitsInterface } from './product-quota.type.js';
import { ProductQuotaExceededError } from './product-quota-exceeded.error.js';
import type { RequestPriceObservationUseCase } from './request-price-observation.use-case.js';
import { UnknownCityError } from './unknown-city.error.js';
import { UnsupportedProductUrlError } from './unsupported-product-url.error.js';

const jane = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';
const sam = '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33';
const roomy: ProductLimitsInterface = {
  maxProducts: 100,
  maxProductsPerGroup: 5,
  add: { limit: 100, windowMs: 60_000 },
};

interface PriceReadInterface {
  userId: string;
  productId: string;
}

/** Counts the products registered, to tell a product refused before it was created from one created and left. */
class CountingProducts extends InMemoryTrackedProductRepositoryAdapter {
  added = 0;

  override add(
    ...args: Parameters<InMemoryTrackedProductRepositoryAdapter['add']>
  ): ReturnType<InMemoryTrackedProductRepositoryAdapter['add']> {
    this.added += 1;

    return super.add(...args);
  }
}

function setup(
  limits: ProductLimitsInterface = roomy,
  request: Pick<RequestPriceObservationUseCase, 'execute'> | null = null,
  products: InMemoryTrackedProductRepositoryAdapter = new InMemoryTrackedProductRepositoryAdapter(),
  cities: MarketplaceCitiesPort = {
    find: (): Promise<KnownCityInterface | null> => Promise.resolve(null),
  },
): {
  add: AddProductUseCase;
  products: InMemoryTrackedProductRepositoryAdapter;
  observations: InMemoryPriceObservationRepositoryAdapter;
  groups: InMemoryProductGroupRepositoryAdapter;
  reads: PriceReadInterface[];
} {
  const observations = new InMemoryPriceObservationRepositoryAdapter();
  const groups = new InMemoryProductGroupRepositoryAdapter();
  const reads: PriceReadInterface[] = [];
  const reading: Pick<RequestPriceObservationUseCase, 'execute'> = request ?? {
    execute: (userId, productId): Promise<{ jobId: string }> => {
      reads.push({ userId, productId });

      return Promise.resolve({ jobId: `job-${String(reads.length)}` });
    },
  };

  return {
    add: new AddProductUseCase(
      new ResolveProductReferenceUseCase([
        new OzonReferenceParser(),
        new DnsReferenceParser(),
        new WildberriesReferenceParser(),
      ]),
      products,
      groups,
      observations,
      reading,
      new InMemoryRateLimiterAdapter(),
      limits,
      undefined,
      undefined,
      cities,
    ),
    products,
    observations,
    groups,
    reads,
  };
}

void test('tracks a product once per user whatever the link to it', async (): Promise<void> => {
  const { add } = setup();

  const first = await add.execute(jane, 'https://www.ozon.ru/product/asus-4775581891/?sh=share');
  assert.equal(first.created, true);
  assert.equal(first.product.snapshot.url, 'https://www.ozon.ru/product/4775581891/');
  assert.equal(first.product.snapshot.externalId, '4775581891');

  const second = await add.execute(jane, 'https://ozon.ru/product/4775581891/');
  assert.equal(second.created, false);
  assert.equal(second.product.snapshot.id, first.product.snapshot.id);
  await assert.rejects(add.execute(jane, 'https://example.com/item/1'), UnsupportedProductUrlError);
});

void test('users share a product and its price history: the second one joins the first', async (): Promise<void> => {
  const { add } = setup();

  const first = await add.execute(jane, 'https://www.ozon.ru/product/4775581891/');
  const joined = await add.execute(sam, 'https://www.ozon.ru/product/4775581891/');

  assert.equal(joined.created, true);
  assert.equal(joined.product.snapshot.id, first.product.snapshot.id);
});

void test('queues the read of the first price when the product has none, and says which job it is', async (): Promise<void> => {
  const { add, reads } = setup();

  const added = await add.execute(jane, 'https://www.ozon.ru/product/1/');

  assert.equal(added.jobId, 'job-1');
  assert.deepEqual(reads, [{ userId: jane, productId: added.product.snapshot.id }]);
});

void test('queues no read when a user adds a product they track already', async (): Promise<void> => {
  const { add, reads } = setup();
  await add.execute(jane, 'https://www.ozon.ru/product/1/');

  const again = await add.execute(jane, 'https://www.ozon.ru/product/1/');

  assert.equal(again.created, false);
  assert.equal(again.jobId, null);
  assert.equal(reads.length, 1);
});

void test('reads no price again for a product that has one: the others added it before', async (): Promise<void> => {
  const { add, observations, reads } = setup();
  const { product } = await add.execute(jane, 'https://www.ozon.ru/product/1/');
  await observations.saveIfAbsent({
    id: '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a22',
    trackedProductId: product.snapshot.id,
    jobId: '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a23',
    title: 'Notebook',
    observedAt: new Date(),
    availability: 'in_stock',
    prices: [{ amountMinor: 100, currency: 'RUB' }],
    exitIp: null,
  });
  reads.length = 0;

  const joined = await add.execute(sam, 'https://www.ozon.ru/product/1/');

  assert.equal(joined.created, true);
  assert.equal(joined.jobId, null);
  assert.equal(reads.length, 0);
});

void test('tracks the product all the same when its price cannot be read now', async (): Promise<void> => {
  const { add, products } = setup(roomy, {
    execute: (): Promise<{ jobId: string }> => Promise.reject(new NoProxiesAvailableError()),
  });

  const added = await add.execute(jane, 'https://www.ozon.ru/product/1/');
  assert.equal(added.created, true);
  assert.equal(added.jobId, null);
  assert.notEqual(await products.findSubscribed(jane, added.product.snapshot.id), null);

  const outage = setup(roomy, {
    execute: (): Promise<{ jobId: string }> => Promise.reject(new Error('redis is down')),
  });
  assert.equal((await outage.add.execute(jane, 'https://www.ozon.ru/product/1/')).jobId, null);
});

void test('lets a user track so many products, and takes no more, nor creates a product for nothing', async (): Promise<void> => {
  const counting = new CountingProducts();
  const { add } = setup(
    { maxProducts: 2, maxProductsPerGroup: 5, add: { limit: 100, windowMs: 60_000 } },
    null,
    counting,
  );
  await add.execute(jane, 'https://www.ozon.ru/product/1/');
  await add.execute(jane, 'https://www.ozon.ru/product/2/');

  await assert.rejects(
    add.execute(jane, 'https://www.ozon.ru/product/3/'),
    ProductQuotaExceededError,
  );

  assert.equal(counting.added, 2);
  // Another user is not held by the quota of this one.
  await add.execute(sam, 'https://www.ozon.ru/product/3/');
  assert.equal(counting.added, 3);
});

void test('does not refuse a product the user tracks already when their quota is full', async (): Promise<void> => {
  const { add, reads } = setup({
    maxProducts: 1,
    maxProductsPerGroup: 5,
    add: { limit: 100, windowMs: 60_000 },
  });
  const first = await add.execute(jane, 'https://www.ozon.ru/product/1/');

  const again = await add.execute(jane, 'https://ozon.ru/product/1/');

  assert.equal(again.created, false);
  assert.equal(again.jobId, null);
  assert.equal(again.product.snapshot.id, first.product.snapshot.id);
  assert.equal(reads.length, 1);
  await assert.rejects(
    add.execute(jane, 'https://www.ozon.ru/product/2/'),
    ProductQuotaExceededError,
  );
});

void test('does not queue the first read again for a second user who adds the product while it is on its way', async (): Promise<void> => {
  const { add, products, reads } = setup();
  const first = await add.execute(jane, 'https://www.ozon.ru/product/1/');
  assert.equal(reads.length, 1);
  // Nothing is read yet, but the read is queued and marked.
  await products.markRequested([first.product.snapshot.id], new Date());

  const second = await add.execute(sam, 'https://www.ozon.ru/product/1/');

  assert.equal(second.created, true);
  assert.equal(second.jobId, null);
  assert.equal(reads.length, 1);
});

void test('queues the first read again when the one asked for long ago brought no price', async (): Promise<void> => {
  const { add, products, reads } = setup();
  const first = await add.execute(jane, 'https://www.ozon.ru/product/1/');
  await products.markRequested([first.product.snapshot.id], new Date(Date.now() - 10 * 60_000));

  const second = await add.execute(sam, 'https://www.ozon.ru/product/1/');

  assert.notEqual(second.jobId, null);
  assert.equal(reads.length, 2);
});

void test('lets a user add so fast, and stops one who adds faster, whatever the products', async (): Promise<void> => {
  const { add } = setup({
    maxProducts: 100,
    maxProductsPerGroup: 5,
    add: { limit: 2, windowMs: 60_000 },
  });

  await add.execute(jane, 'https://www.ozon.ru/product/1/');
  await add.execute(jane, 'https://www.ozon.ru/product/1/');
  await assert.rejects(add.execute(jane, 'https://www.ozon.ru/product/2/'), TooManyRequestsError);

  await add.execute(sam, 'https://www.ozon.ru/product/2/');
});

void test('the history of a product is for those who track it: to the others it does not exist', async (): Promise<void> => {
  const { add, products, observations } = setup();
  const { product } = await add.execute(jane, 'https://www.ozon.ru/product/1/');
  const history = new ListPriceHistoryUseCase(products, observations);

  const own = await history.execute(jane, product.snapshot.id, { page: 1, pageSize: 10 });
  assert.equal(own.product.snapshot.id, product.snapshot.id);

  await assert.rejects(
    history.execute(sam, product.snapshot.id, { page: 1, pageSize: 10 }),
    ProductNotFoundError,
  );
});

/** An add whose link takes its time to expand, until the test lets it go. */
function slowAdd(limits: ProductLimitsInterface = roomy): {
  add: AddProductUseCase;
  expansions: string[];
  finish: () => void;
} {
  const expansions: string[] = [];
  let finish = (): void => undefined;
  const expanded = new Promise<void>((resolve): void => {
    finish = resolve;
  });

  return {
    add: new AddProductUseCase(
      new ResolveProductReferenceUseCase([new OzonReferenceParser()]),
      new InMemoryTrackedProductRepositoryAdapter(),
      new InMemoryProductGroupRepositoryAdapter(),
      new InMemoryPriceObservationRepositoryAdapter(),
      { execute: (): Promise<{ jobId: string }> => Promise.reject(new NoProxiesAvailableError()) },
      new InMemoryRateLimiterAdapter(),
      limits,
      undefined,
      {
        execute: async (url): Promise<string> => {
          expansions.push(url);
          await expanded;

          return 'https://www.ozon.ru/product/1/';
        },
      },
    ),
    expansions,
    finish,
  };
}

void test('joins the same link sent again while it is being added, and counts it once', async (): Promise<void> => {
  const { add, expansions, finish } = slowAdd({
    maxProducts: 100,
    maxProductsPerGroup: 5,
    add: { limit: 1, windowMs: 60_000 },
  });

  const first = add.execute(jane, 'https://ozon.ru/t/AbC');
  const again = add.execute(jane, 'https://ozon.ru/t/AbC');
  finish();

  assert.equal((await first).product.snapshot.id, (await again).product.snapshot.id);
  assert.deepEqual(expansions, ['https://ozon.ru/t/AbC']);
});

void test('refuses another link of a user while one is being added, and takes it afterwards', async (): Promise<void> => {
  const { add, finish } = slowAdd();

  const first = add.execute(jane, 'https://ozon.ru/t/AbC');
  await assert.rejects(add.execute(jane, 'https://ozon.ru/t/Other'), ProductAddingInProgressError);
  // Another user is not held by it.
  const other = add.execute(sam, 'https://ozon.ru/t/Third');
  finish();
  await first;
  await other;

  await add.execute(jane, 'https://ozon.ru/t/Other');
});

const irkutsk = '30b7c1f1-03fb-11dc-95ee-00151716f9f5';
const dnsLink = 'https://www.dns-shop.ru/product/0463bb2411a1d582/156-noutbuk-asus/';
const knownCities: MarketplaceCitiesPort = {
  find: (_marketplace, cityId): Promise<KnownCityInterface | null> =>
    Promise.resolve(cityId === irkutsk ? { id: irkutsk, name: 'Иркутск', aliases: [] } : null),
};
const moscow = marketplaceDefaultCities.dns;
if (moscow === undefined) throw new Error('DNS has a default city');

void test('a product of a marketplace with cities is tracked in the default city unless a city is asked for', async (): Promise<void> => {
  const { add } = setup(roomy, null, undefined, knownCities);

  const byDefault = await add.execute(jane, dnsLink);
  const asked = await add.execute(jane, dnsLink, irkutsk);

  assert.equal(byDefault.product.snapshot.cityId, moscow.id);
  assert.equal(byDefault.product.snapshot.cityName, 'Москва');
  assert.equal(asked.product.snapshot.cityId, irkutsk);
  assert.equal(asked.product.snapshot.cityName, 'Иркутск');
  assert.equal(asked.created, true);
  assert.notEqual(asked.product.snapshot.id, byDefault.product.snapshot.id);
  assert.equal(asked.product.snapshot.externalId, byDefault.product.snapshot.externalId);
});

void test('users who track a product in the same city share it, and not across cities', async (): Promise<void> => {
  const { add } = setup(roomy, null, undefined, knownCities);

  const janes = await add.execute(jane, dnsLink, irkutsk);
  const sams = await add.execute(sam, dnsLink, irkutsk);
  const other = await add.execute(sam, dnsLink);

  assert.equal(sams.product.snapshot.id, janes.product.snapshot.id);
  assert.notEqual(other.product.snapshot.id, janes.product.snapshot.id);
});

void test('refuses a city the marketplace is not known to have, but not its default city', async (): Promise<void> => {
  const { add } = setup(roomy, null, undefined, knownCities);

  await assert.rejects(
    add.execute(jane, dnsLink, '11111111-1111-1111-1111-111111111111'),
    UnknownCityError,
  );
  const byDefault = await add.execute(jane, dnsLink, moscow.id);
  assert.equal(byDefault.product.snapshot.cityId, moscow.id);
});

const wildberriesLink = 'https://www.wildberries.ru/catalog/175088486/detail.aspx';

void test('an item tracked in a city by an id the city had before is the same product', async (): Promise<void> => {
  let spb = { id: '-1205339', name: 'Санкт-Петербург', aliases: ['-1198680'] };
  const cities: MarketplaceCitiesPort = {
    find: (_marketplace, cityId): Promise<KnownCityInterface | null> =>
      Promise.resolve(cityId === spb.id || spb.aliases.includes(cityId) ? spb : null),
  };
  const { add } = setup(roomy, null, undefined, cities);
  const before = await add.execute(jane, wildberriesLink, '-1205339');

  // The handbook was read again, and the city is known by another id now.
  spb = { id: '-1198680', name: 'Санкт-Петербург', aliases: ['-1205339'] };
  const after = await add.execute(sam, wildberriesLink, '-1198680');

  assert.equal(after.product.snapshot.id, before.product.snapshot.id);
  assert.equal(after.product.snapshot.cityId, '-1205339');
});

void test('the default city is the one of the handbook when it was read', async (): Promise<void> => {
  const moscow = { id: '-1257403', name: 'Москва', aliases: [] };
  const cities: MarketplaceCitiesPort = {
    find: (_marketplace, cityId): Promise<KnownCityInterface | null> =>
      Promise.resolve(cityId === moscow.id ? moscow : null),
  };
  const { add } = setup(roomy, null, undefined, cities);

  const byDefault = await add.execute(jane, wildberriesLink);
  const asked = await add.execute(sam, wildberriesLink, '-1257403');

  assert.equal(byDefault.product.snapshot.cityId, '-1257403');
  assert.equal(asked.product.snapshot.id, byDefault.product.snapshot.id);
});

void test('a product tracked before its marketplace had cities is the one of its default city', async (): Promise<void> => {
  const { add, products } = setup();
  const before = await products.add({
    marketplace: 'ozon',
    externalId: '4775581891',
    url: 'https://www.ozon.ru/product/4775581891/',
    cityId: null,
    cityName: null,
  });

  const byDefault = await add.execute(jane, 'https://www.ozon.ru/product/4775581891/');
  const another = await add.execute(jane, 'https://www.ozon.ru/product/1/');

  assert.equal(byDefault.product.snapshot.id, before.product.snapshot.id);
  assert.equal(byDefault.product.snapshot.cityId, null);
  assert.equal(another.product.snapshot.cityId, 'moskva');
  assert.equal(another.product.snapshot.cityName, 'Москва');
});

void test('a product added alone goes into a new group of the user', async (): Promise<void> => {
  const { add, groups } = setup();

  const first = await add.execute(jane, 'https://www.ozon.ru/product/1/');
  const second = await add.execute(jane, 'https://www.ozon.ru/product/2/');

  assert.notEqual(first.groupId, second.groupId);
  assert.equal(
    (await groups.findOwned(jane, first.groupId))?.snapshot.title,
    null,
    'the group is called after its product until the user names it',
  );
  assert.equal(await groups.findGroupIdOfProduct(jane, first.product.snapshot.id), first.groupId);
});

void test('products added to a group stay together in the order they were added', async (): Promise<void> => {
  const { add, groups } = setup();
  const group = await groups.create(jane, 'Phone');

  const ozon = await add.execute(jane, 'https://www.ozon.ru/product/1/', null, group.snapshot.id);
  const dns = await add.execute(
    jane,
    `https://www.dns-shop.ru/product/a1b2c3d4e5f6a7b8/phone/`,
    null,
    group.snapshot.id,
  );

  assert.deepEqual([ozon.groupId, dns.groupId], [group.snapshot.id, group.snapshot.id]);
  assert.deepEqual(
    (await groups.listProductIds([group.snapshot.id])).map(({ productId }): string => productId),
    [ozon.product.snapshot.id, dns.product.snapshot.id],
  );
});

void test("refuses a group that is not the user's, or is full, before anything is added", async (): Promise<void> => {
  const { add, groups, products } = setup({
    maxProducts: 100,
    maxProductsPerGroup: 1,
    add: { limit: 100, windowMs: 60_000 },
  });
  const group = await groups.create(jane, null);
  await add.execute(jane, 'https://www.ozon.ru/product/1/', null, group.snapshot.id);

  await assert.rejects(
    add.execute(jane, 'https://www.ozon.ru/product/2/', null, group.snapshot.id),
    ProductGroupFullError,
  );
  await assert.rejects(
    add.execute(sam, 'https://www.ozon.ru/product/2/', null, group.snapshot.id),
    ProductGroupNotFoundError,
  );
  assert.equal((await products.stats()).products, 1);
});

void test('a product the user tracks already stays in its group', async (): Promise<void> => {
  const { add, groups } = setup();
  const other = await groups.create(jane, null);
  const first = await add.execute(jane, 'https://www.ozon.ru/product/1/');

  const again = await add.execute(jane, 'https://www.ozon.ru/product/1/', null, other.snapshot.id);

  assert.equal(again.groupId, first.groupId);
});
