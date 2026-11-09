import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  JobQueuePort,
  PriceFetchRequestInterface,
} from '../../job/application/job-queue.port.js';
import { ScheduleJobUseCase } from '../../job/application/schedule-job.use-case.js';
import { InMemoryJobRepositoryAdapter } from '../../job/infrastructure/in-memory-job-repository.adapter.js';
import type { ClockPort } from '../../shared/application/clock.port.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import type { ChoosePriceRoutesUseCase } from './choose-price-routes.use-case.js';
import { RefreshPricesUseCase } from './refresh-prices.use-case.js';
import { SpreadPriceJobsUseCase } from './spread-price-jobs.use-case.js';

const hour = 3_600_000;
const start = new Date('2026-10-31T10:00:00Z');
const jane = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';
const route = { server: 'socks5://217.71.230.1:1080' };
const otherRoute = { server: 'socks5://217.71.230.2:1080' };
const lagMs = 30_000;

interface SetupInterface {
  refresh: RefreshPricesUseCase;
  products: InMemoryTrackedProductRepositoryAdapter;
  jobs: InMemoryJobRepositoryAdapter;
  requests: PriceFetchRequestInterface[];
  at: (hours: number) => void;
  queue: { failing: boolean };
}

function setup(
  routes: Array<typeof route> = [route],
  batchSize = 200,
  refreshAfterMs = 50 * 60_000,
): SetupInterface {
  let current = start;
  const clock: ClockPort = { now: (): Date => current };
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const jobs = new InMemoryJobRepositoryAdapter();
  const requests: PriceFetchRequestInterface[] = [];
  const queue = { failing: false };
  const port: JobQueuePort = {
    enqueueProxyFetch: (): Promise<void> => Promise.resolve(),
    enqueueHandbookFetch: (): Promise<void> => Promise.resolve(),
    enqueuePriceFetch: (request): Promise<void> => {
      if (queue.failing) return Promise.reject(new Error('redis is down'));
      requests.push(request);

      return Promise.resolve();
    },
  };
  const chooseRoutes: Pick<ChoosePriceRoutesUseCase, 'execute'> = {
    execute: (): Promise<Array<typeof route>> => Promise.resolve(routes),
  };

  return {
    refresh: new RefreshPricesUseCase(
      products,
      chooseRoutes,
      new ScheduleJobUseCase(port, jobs),
      new SpreadPriceJobsUseCase(lagMs),
      { refreshAfterMs, cohortMs: 10 * 60_000, batchSize, timeoutMs: 30_000 },
      clock,
    ),
    products,
    jobs,
    requests,
    at: (hours): void => {
      current = new Date(start.getTime() + hours * hour);
    },
    queue,
  };
}

async function track(
  products: InMemoryTrackedProductRepositoryAdapter,
  n: number,
  userId: string | null = jane,
): Promise<string> {
  const { product } = await products.add({
    marketplace: 'ozon',
    externalId: String(n),
    url: `https://www.ozon.ru/product/${String(n)}/`,
    cityId: null,
    cityName: null,
  });
  if (userId !== null) await products.subscribe(userId, product.snapshot.id);

  return product.snapshot.id;
}

void test("queues the read of the products nobody has read yet, in one job, and records the job as the hub's own", async (): Promise<void> => {
  const { refresh, products, jobs, requests } = setup();
  const [first, second] = [await track(products, 1), await track(products, 2)];

  const result = await refresh.execute();

  assert.deepEqual(result, { products: 2, jobs: 1 });
  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.ok(request);
  assert.deepEqual(
    request.products.map((product): string => product.trackedProductId).toSorted(),
    [first, second].toSorted(),
  );
  assert.deepEqual(request.routes, [route]);
  const { items } = await jobs.list({ kind: 'price_fetch' }, { page: 1, pageSize: 10 });
  assert.equal(items.length, 1);
  const [job] = items;
  assert.ok(job);
  assert.equal(job.snapshot.requestedBy, null);
  assert.equal(job.snapshot.total, 2);
});

void test('does not queue a product again while its job may still be on its way, nor one nobody tracks', async (): Promise<void> => {
  const { refresh, products, requests, at } = setup();
  await track(products, 1);
  await track(products, 2, null);

  await refresh.execute();
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.products.length, 1);

  at(0.5);
  assert.deepEqual(await refresh.execute(), { products: 0, jobs: 0 });
  assert.equal(requests.length, 1);
});

void test('queues a product again once its last read or request is older than the refresh age', async (): Promise<void> => {
  const { refresh, products, requests, at } = setup();
  const id = await track(products, 1);
  await refresh.execute();

  at(7);
  await refresh.execute();

  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.products[0]?.trackedProductId, id);

  // A read that came back (even a failed one) counts as fresh as well.
  await products.markChecked(id, 'ok', new Date(start.getTime() + 12 * hour));
  at(12.5);
  assert.deepEqual(await refresh.execute(), { products: 0, jobs: 0 });
});

void test('reads a price again 50 minutes after its last read, and not a minute sooner', async (): Promise<void> => {
  const { refresh, products, requests, at } = setup();
  const id = await track(products, 1);
  await refresh.execute();
  await products.markChecked(id, 'ok', new Date(start.getTime() + 5 * 60_000));

  at(54 / 60);
  assert.deepEqual(await refresh.execute(), { products: 0, jobs: 0 });

  at(56 / 60);
  assert.deepEqual(await refresh.execute(), { products: 1, jobs: 1 });
  assert.equal(requests.length, 2);
});

void test('catches up on everything that fell due while the hub was down', async (): Promise<void> => {
  const { refresh, products, requests, at } = setup([route], 200, 50 * 60_000);
  for (let n = 1; n <= 3; n += 1) await track(products, n);
  await refresh.execute();

  at(30);

  assert.deepEqual(await refresh.execute(), { products: 3, jobs: 1 });
  assert.equal(requests.length, 2);
});

void test('starts the jobs that run together on different proxies, and a lag apart on one proxy', async (): Promise<void> => {
  const several = setup([route, otherRoute], 200);
  for (let n = 1; n <= 100; n += 1) await track(several.products, n);

  await several.refresh.execute();

  assert.deepEqual(
    several.requests.map((request): string | undefined => request.routes[0]?.server),
    [route.server, otherRoute.server],
  );
  assert.deepEqual(
    several.requests.map((request): number | undefined => request.delayMs),
    [0, 0],
  );

  const single = setup([route], 200);
  for (let n = 1; n <= 150; n += 1) await track(single.products, n);

  await single.refresh.execute();

  assert.deepEqual(
    single.requests.map((request): number | undefined => request.delayMs),
    [0, lagMs, 2 * lagMs],
  );
});

void test('waits for a route instead of queueing a job that cannot run: the products stay due', async (): Promise<void> => {
  const { refresh, products, requests, jobs } = setup([]);
  await track(products, 1);

  assert.deepEqual(await refresh.execute(), { products: 0, jobs: 0 });
  assert.equal(requests.length, 0);
  assert.equal((await jobs.list({}, { page: 1, pageSize: 10 })).total, 0);
});

void test('splits a long list into jobs the worker takes, and reads no more than the batch of one run', async (): Promise<void> => {
  const { refresh, products, requests } = setup([route], 120);
  for (let n = 1; n <= 150; n += 1) await track(products, n);

  const result = await refresh.execute();

  assert.deepEqual(result, { products: 120, jobs: 3 });
  assert.deepEqual(
    requests.map((request): number => request.products.length),
    [50, 50, 20],
  );

  assert.deepEqual(await refresh.execute(), { products: 30, jobs: 1 });
});

void test('a job the queue refuses leaves its products due for the next run, and does not stop the others', async (): Promise<void> => {
  const { refresh, products, requests, queue } = setup();
  await track(products, 1);

  queue.failing = true;
  assert.deepEqual(await refresh.execute(), { products: 0, jobs: 0 });

  queue.failing = false;
  assert.deepEqual(await refresh.execute(), { products: 1, jobs: 1 });
  assert.equal(requests.length, 1);
});

void test('names the city of a product in the job of the schedule', async (): Promise<void> => {
  const { refresh, products, requests } = setup();
  const cityId = '30b7c1f1-03fb-11dc-95ee-00151716f9f5';
  const { product } = await products.add({
    marketplace: 'dns',
    externalId: '0463bb2411a1d582',
    url: 'https://www.dns-shop.ru/product/0463bb2411a1d582/',
    cityId,
    cityName: 'Иркутск',
  });
  await products.subscribe(jane, product.snapshot.id);

  await refresh.execute();

  assert.deepEqual(requests[0]?.products, [
    { trackedProductId: product.snapshot.id, url: product.snapshot.url, cityId },
  ]);
});

async function trackIn(
  products: InMemoryTrackedProductRepositoryAdapter,
  marketplace: 'wildberries' | 'ozon',
  n: number,
  cityId: string | null,
): Promise<string> {
  const { product } = await products.add({
    marketplace,
    externalId: String(n),
    url:
      marketplace === 'ozon'
        ? `https://www.ozon.ru/product/${String(n)}/`
        : `https://www.wildberries.ru/catalog/${String(n)}/detail.aspx`,
    cityId,
    cityName: cityId === null ? null : 'Город',
  });
  await products.subscribe(jane, product.snapshot.id);

  return product.snapshot.id;
}

void test('a job reads the products of one marketplace and one city', async (): Promise<void> => {
  const { refresh, products, requests } = setup();
  await trackIn(products, 'wildberries', 1, null);
  await trackIn(products, 'wildberries', 2, '-1257403');
  await trackIn(products, 'wildberries', 3, null);
  await trackIn(products, 'ozon', 4, null);

  assert.deepEqual(await refresh.execute(), { products: 4, jobs: 3 });
  assert.deepEqual(
    requests.map(({ products: read }): string[] =>
      read.map(
        ({ url, cityId }): string =>
          `${new URL(url).hostname} ${url.replace(/\D/g, '')} ${cityId ?? ''}`,
      ),
    ),
    [
      ['www.wildberries.ru 1 ', 'www.wildberries.ru 3 '],
      ['www.wildberries.ru 2 -1257403'],
      ['www.ozon.ru 4 '],
    ],
  );
});

void test('reads with a due product the nearly due ones of its marketplace and city, and not the others', async (): Promise<void> => {
  const { refresh, products, requests, at } = setup();
  const due = await trackIn(products, 'wildberries', 1, null);
  const nearly = await trackIn(products, 'wildberries', 2, null);
  const elsewhere = await trackIn(products, 'wildberries', 3, '-1257403');
  await products.markChecked(due, 'ok', start);
  await products.markChecked(nearly, 'ok', new Date(start.getTime() + 8 * 60_000));
  await products.markChecked(elsewhere, 'ok', new Date(start.getTime() + 8 * 60_000));

  at(51 / 60);

  assert.deepEqual(await refresh.execute(), { products: 2, jobs: 1 });
  assert.deepEqual(
    requests.at(-1)?.products.map(({ trackedProductId }): string => trackedProductId),
    [due, nearly],
  );
  assert.deepEqual(await refresh.execute(), { products: 0, jobs: 0 });
});
