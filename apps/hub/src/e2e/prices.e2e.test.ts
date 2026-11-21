import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { z } from 'zod';

import { DockerStackAdapter } from './support/docker-stack.adapter.js';
import { FakePriceWorkerAdapter } from './support/fake-price-worker.adapter.js';
import type { HttpClientAdapter } from './support/http-client.adapter.js';
import {
  connectDatabase,
  eventually,
  operatorApiKey,
  type RunningHubInterface,
  seedProxies,
  startHub,
} from './support/hub-harness.js';

/**
 * Tracking products and reading their prices end to end: the hub, a real Postgres, and a real Redis whose
 * queues a worker takes the jobs from and answers on. The worker is the one thing replaced, since it
 * drives a browser through a marketplace: its queues and messages are the real ones of the `queue-worker`
 * package, and the prices it finds are a table.
 */
const stack = new DockerStackAdapter();
const productUrl = 'https://www.ozon.ru/product/4775581891/';
const sportmasterCity = { id: '28300299', name: 'Казань', region: 'Республика Татарстан' };
const aliexpressCity = {
  id: '917473757371000000',
  name: 'Иркутск',
  region: 'Иркутская область',
};
const aptekaCity = { id: 'irkutsk', name: 'Иркутск', region: 'Иркутская область' };
let hub: RunningHubInterface;
let worker: FakePriceWorkerAdapter;
let database: ReturnType<typeof connectDatabase>;
let jane: HttpClientAdapter;
let sam: HttpClientAdapter;
let productId = '';
let firstJobId = '';

const productSchema = z.object({ id: z.uuid(), jobId: z.uuid().nullable() });
const historySchema = z.object({
  total: z.number(),
  items: z.array(z.object({ prices: z.array(z.object({ amountMinor: z.number() })) })),
});
const jobSchema = z.object({ status: z.string(), percent: z.number(), kind: z.string() });

before(
  async (): Promise<void> => {
    const infrastructure = await stack.start();
    database = connectDatabase(infrastructure.databaseUrl);
    await seedProxies(database, ['socks5://217.71.230.1:1080']);
    await database.handbook.create({
      data: { key: 'sportmaster-cities', data: [sportmasterCity], fetchedAt: new Date() },
    });
    await database.handbook.create({
      data: { key: 'aliexpress-cities', data: [aliexpressCity], fetchedAt: new Date() },
    });
    await database.handbook.create({
      data: { key: 'apteka-cities', data: [aptekaCity], fetchedAt: new Date() },
    });

    worker = new FakePriceWorkerAdapter(infrastructure.redisUrl);
    worker.setPrice(productUrl, 129_900);
    worker.start();

    hub = await startHub({
      stack: infrastructure,
      // The schedule looks every second for products whose price is older than a minute.
      env: { PRICE_REFRESH_POLL_MS: '1000', PRICE_REFRESH_AFTER_MS: '60000' },
    });
    [jane, sam] = [hub.browser(), hub.browser()];
    for (const [browser, email] of [
      [jane, 'jane@example.com'],
      [sam, 'sam@example.com'],
    ] as const) {
      await browser.request('/auth/register', { json: { email, password: 'correct-horse' } });
      await browser.request('/auth/login', { json: { email, password: 'correct-horse' } });
    }
  },
  { timeout: 120_000 },
);

after(
  async (): Promise<void> => {
    await hub.stop();
    await worker.stop();
    await database.$disconnect();
    await stack.stop();
  },
  { timeout: 60_000 },
);

async function historyOf(
  browser: HttpClientAdapter,
): Promise<z.infer<typeof historySchema> | null> {
  const reply = await browser.request(`/products/${productId}/prices`);

  return reply.status === 200 ? historySchema.parse(reply.body) : null;
}

void test('adding a product queues the read of its first price, a worker answers over Redis, and the price shows up', async (): Promise<void> => {
  const added = await jane.request('/products', {
    json: { url: 'https://www.ozon.ru/product/asus-4775581891/?sh=share' },
  });
  assert.equal(added.status, 201);
  const product = productSchema.parse(added.body);
  productId = product.id;
  assert.ok(product.jobId !== null);
  firstJobId = product.jobId;

  const finished = await eventually(async () => {
    const job = jobSchema.parse((await jane.request(`/jobs/${String(product.jobId)}`)).body);

    return job.status === 'completed' ? job : null;
  }, 'the job completed');
  assert.deepEqual(finished, { status: 'completed', percent: 100, kind: 'price_fetch' });

  const history = await historyOf(jane);
  assert.ok(history);
  assert.equal(history.total, 1);
  assert.equal(history.items[0]?.prices[0]?.amountMinor, 129_900);

  // The schedule reads the price again a minute after the last read, which this test sets as the age of a price.
  const shown = z
    .object({ product: z.object({ nextCheckAt: z.iso.datetime().nullable() }) })
    .parse((await jane.request(`/products/${productId}/prices`)).body);
  assert.ok(shown.product.nextCheckAt !== null);
  const wait = Date.parse(shown.product.nextCheckAt) - Date.now();
  assert.ok(wait > 0 && wait <= 60_000, `the next check is in ${String(wait)} ms`);

  // The worker was given the canonical link and the proxy the hub had alive for it.
  assert.equal(worker.jobs.length, 1);
  const [taken] = worker.jobs;
  assert.ok(taken);
  assert.deepEqual(
    taken.products.map((item): string => item.url),
    [productUrl],
  );
  assert.equal(taken.proxies[0]?.server, 'socks5://217.71.230.1:1080');
});

void test('another user joins the product: the same history, no second read, and not the job of the first', async (): Promise<void> => {
  const joined = await sam.request('/products', { json: { url: productUrl } });

  assert.equal(joined.status, 201);
  assert.equal(productSchema.parse(joined.body).id, productId);
  assert.equal(productSchema.parse(joined.body).jobId, null);
  assert.equal((await historyOf(sam))?.total, 1);
  assert.equal(worker.jobs.length, 1);

  // The job of the first user is theirs: a job id is no key to it.
  assert.equal((await sam.request(`/jobs/${firstJobId}`)).status, 404);
});

void test('the routes of the operator take the key, and show the proxies and the jobs', async (): Promise<void> => {
  // A user who is signed in and is no administrator is refused, not asked to sign in.
  assert.equal((await jane.request('/proxies')).status, 403);
  assert.equal((await jane.request('/jobs')).status, 403);

  const key = { authorization: `Bearer ${operatorApiKey}` };
  const proxies = z
    .object({ items: z.array(z.object({ server: z.string() })) })
    .parse((await jane.request('/proxies', { headers: key })).body);
  assert.deepEqual(
    proxies.items.map((item): string => item.server),
    ['socks5://217.71.230.1:1080'],
  );

  const jobs = z
    .object({ total: z.number(), items: z.array(z.object({ kind: z.string() })) })
    .parse((await jane.request('/jobs?kind=price_fetch', { headers: key })).body);
  assert.equal(jobs.total, 1);
});

void test('the schedule reads a stale price again, as a job of the hub, and the history grows', async (): Promise<void> => {
  worker.setPrice(productUrl, 119_900);
  // Seven hours ago: older than the age of a price, so the product is due at the next look of the schedule.
  const longAgo = new Date(Date.now() - 7 * 3_600_000);
  await database.trackedProduct.update({
    where: { id: productId },
    data: { lastCheckedAt: longAgo, lastRequestedAt: longAgo },
  });

  const history = await eventually(async () => {
    const found = await historyOf(jane);

    return found !== null && found.total === 2 ? found : null;
  }, 'the second price in the history');

  assert.deepEqual(
    history.items.map((item): number | undefined => item.prices[0]?.amountMinor).toSorted(),
    [119_900, 129_900],
  );
  assert.equal(worker.jobs.length, 2);

  // It is the job of the hub, not of a user: the users do not read it, the operator sees it.
  const operatorJobs = z.object({ items: z.array(z.object({ id: z.uuid() })) }).parse(
    (
      await jane.request('/jobs?kind=price_fetch', {
        headers: { authorization: `Bearer ${operatorApiKey}` },
      })
    ).body,
  );
  const refreshJob = worker.jobs[1]?.jobId;
  assert.ok(operatorJobs.items.some((job): boolean => job.id === refreshJob));
  assert.equal((await jane.request(`/jobs/${String(refreshJob)}`)).status, 404);
});

void test('the schedule leaves a fresh product alone: a few looks of it queue nothing more', async (): Promise<void> => {
  const before = worker.jobs.length;

  await new Promise((resolve): void => {
    setTimeout(resolve, 1500);
  });

  assert.equal(worker.jobs.length, before);
});

void test('a product goes for good with its last tracker, and not before', async (): Promise<void> => {
  assert.equal((await jane.request(`/products/${productId}`, { method: 'DELETE' })).status, 204);
  assert.equal(await historyOf(jane), null);
  assert.equal((await historyOf(sam))?.total, 2);
  assert.equal(await database.trackedProduct.count({ where: { id: productId } }), 1);

  assert.equal((await sam.request(`/products/${productId}`, { method: 'DELETE' })).status, 204);
  assert.equal(await historyOf(sam), null);
  assert.equal(await database.trackedProduct.count({ where: { id: productId } }), 0);
  assert.equal(
    await database.priceObservation.count({ where: { trackedProductId: productId } }),
    0,
  );
});

void test('searches Sportmaster cities and queues the selected city with the product', async (): Promise<void> => {
  const url = 'https://www.sportmaster.ru/product/33427090299/';
  const city = sportmasterCity;
  worker.setPrice(url, 228_700);

  const search = await jane.request(
    `/marketplaces/sportmaster/cities?query=${encodeURIComponent('Каз')}`,
  );
  assert.equal(search.status, 200);
  assert.deepEqual(search.body, { items: [city] });

  const added = await jane.request('/products', { json: { url, cityId: city.id } });
  assert.equal(added.status, 201);
  const product = productSchema.parse(added.body);
  assert.ok(product.jobId !== null);

  const job = await eventually(
    (): Promise<(typeof worker.jobs)[number] | null> =>
      Promise.resolve(worker.jobs.find(({ jobId }): boolean => jobId === product.jobId) ?? null),
    'the Sportmaster price job reached the worker',
  );
  assert.deepEqual(job.products, [
    { trackedProductId: product.id, url, cityId: city.id, cityName: city.name },
  ]);
});

void test('searches AliExpress cities and queues the selected city with the product', async (): Promise<void> => {
  const url = 'https://aliexpress.ru/item/1005012815784218.html';
  const city = aliexpressCity;
  worker.setPrice(url, 39_900);

  const search = await jane.request(
    `/marketplaces/aliexpress/cities?query=${encodeURIComponent('Ирк')}`,
  );
  assert.equal(search.status, 200);
  assert.deepEqual(search.body, { items: [city] });

  const added = await jane.request('/products', { json: { url, cityId: city.id } });
  assert.equal(added.status, 201);
  const product = productSchema.parse(added.body);
  assert.ok(product.jobId !== null);

  const job = await eventually(
    (): Promise<(typeof worker.jobs)[number] | null> =>
      Promise.resolve(worker.jobs.find(({ jobId }): boolean => jobId === product.jobId) ?? null),
    'the AliExpress price job reached the worker',
  );
  assert.deepEqual(job.products, [{ trackedProductId: product.id, url, cityId: city.id }]);
});

void test('searches Apteka.ru cities and queues the selected city with the product', async (): Promise<void> => {
  const url = 'https://apteka.ru/product/5e32674d65b5ab0001650ab2/';
  const city = aptekaCity;
  worker.setPrice(url, 14_100);

  const search = await jane.request(
    `/marketplaces/apteka/cities?query=${encodeURIComponent('Ирк')}`,
  );
  assert.equal(search.status, 200);
  assert.deepEqual(search.body, { items: [city] });

  const added = await jane.request('/products', { json: { url, cityId: city.id } });
  assert.equal(added.status, 201);
  const product = productSchema.parse(added.body);
  assert.ok(product.jobId !== null);

  const job = await eventually(
    (): Promise<(typeof worker.jobs)[number] | null> =>
      Promise.resolve(worker.jobs.find(({ jobId }): boolean => jobId === product.jobId) ?? null),
    'the Apteka.ru price job reached the worker',
  );
  assert.deepEqual(job.products, [{ trackedProductId: product.id, url, cityId: city.id }]);
});
