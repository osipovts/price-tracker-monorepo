import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ScheduleJobUseCase } from '../../job/application/index.js';
import type {
  JobQueuePort,
  PriceFetchRequestInterface,
} from '../../job/application/job-queue.port.js';
import { InMemoryJobRepositoryAdapter } from '../../job/infrastructure/in-memory-job-repository.adapter.js';
import { ListBestProxyServersUseCase } from '../../proxy/application/index.js';
import { ProxyEntity } from '../../proxy/domain/proxy.entity.js';
import { InMemoryProxyRepositoryAdapter } from '../../proxy/infrastructure/in-memory-proxy-repository.adapter.js';
import { InMemoryProxyReputationRepositoryAdapter } from '../../proxy/infrastructure/in-memory-proxy-reputation-repository.adapter.js';
import { systemClock } from '../../shared/application/clock.port.js';
import { NoProxiesAvailableError } from '../../shared/application/no-proxies-available.error.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import { ChoosePriceRoutesUseCase } from './choose-price-routes.use-case.js';
import { ProductNotFoundError } from './product-not-found.error.js';
import { RequestPriceObservationUseCase } from './request-price-observation.use-case.js';
import type { TrackedProductReferenceInterface } from './tracked-product-repository.port.js';

function proxy(server: string, alive: boolean, checksAlive: number): ProxyEntity {
  return new ProxyEntity({
    server,
    source: 'github-free-proxy-list',
    country: 'RU',
    exitIp: null,
    alive,
    latencyMs: 200,
    checksTotal: 4,
    checksAlive,
    lastCheckedAt: new Date('2026-10-24T12:00:00.000Z'),
    lastSeenAt: new Date('2026-10-24T12:00:00.000Z'),
    disabledAt: null,
    credentials: null,
  });
}

const productUrl = 'https://www.ozon.ru/product/4775581891/';
const userId = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';

async function createUseCase(
  proxies: ProxyEntity[],
  failQueue = false,
  tracked: TrackedProductReferenceInterface = {
    marketplace: 'ozon',
    externalId: '4775581891',
    url: productUrl,
    cityId: null,
    cityName: null,
  },
): Promise<{
  useCase: RequestPriceObservationUseCase;
  requests: PriceFetchRequestInterface[];
  jobs: InMemoryJobRepositoryAdapter;
  productId: string;
}> {
  const repository = new InMemoryProxyRepositoryAdapter();
  await repository.saveMany(proxies);

  const products = new InMemoryTrackedProductRepositoryAdapter();
  const { product } = await products.add(tracked);
  await products.subscribe(userId, product.snapshot.id);

  const jobs = new InMemoryJobRepositoryAdapter();
  const requests: PriceFetchRequestInterface[] = [];
  const queue: JobQueuePort = {
    enqueueProxyFetch: (): Promise<void> => Promise.resolve(),
    enqueueHandbookFetch: (): Promise<void> => Promise.resolve(),
    enqueuePriceFetch: (request): Promise<void> => {
      if (failQueue) return Promise.reject(new Error('redis is down'));
      requests.push(request);

      return Promise.resolve();
    },
  };

  return {
    useCase: new RequestPriceObservationUseCase(
      products,
      new ChoosePriceRoutesUseCase(
        new ListBestProxyServersUseCase(
          repository,
          new InMemoryProxyReputationRepositoryAdapter(),
          systemClock,
          (): number => 0.25,
        ),
        2,
      ),
      new ScheduleJobUseCase(queue, jobs),
      30000,
    ),
    requests,
    jobs,
    productId: product.snapshot.id,
  };
}

void test('queues the product with the best alive proxies and records the job', async (): Promise<void> => {
  const { useCase, requests, jobs, productId } = await createUseCase([
    proxy('socks5://217.71.230.1:1080', true, 2),
    proxy('socks5://217.71.230.2:1080', true, 4),
    proxy('socks5://217.71.230.3:1080', true, 3),
    proxy('socks5://217.71.230.4:1080', false, 4),
  ]);

  const { jobId } = await useCase.execute(userId, productId);

  const request = requests[0];
  assert.ok(request);
  assert.equal(request.jobId, jobId);
  assert.deepEqual(request.routes, [
    { server: 'socks5://217.71.230.2:1080' },
    { server: 'socks5://217.71.230.3:1080' },
  ]);
  assert.deepEqual(request.products, [{ trackedProductId: productId, url: productUrl }]);
  assert.equal(request.timeoutMs, 30000);

  const job = await jobs.findById(jobId);
  assert.equal(job?.snapshot.status, 'queued');
  assert.equal(job.snapshot.kind, 'price_fetch');
  assert.equal(job.snapshot.subject, productId);
  assert.equal(job.snapshot.total, 1);
});

void test('gives the manual proxies first, with their credentials', async (): Promise<void> => {
  const manual = ProxyEntity.manual(
    'http://217.71.230.5:3128',
    { username: 'user', password: 'secret' },
    new Date('2026-10-31T10:00:00Z'),
  );
  const { useCase, requests, productId } = await createUseCase([
    proxy('socks5://217.71.230.1:1080', true, 4),
    manual,
  ]);

  await useCase.execute(userId, productId);

  assert.deepEqual(
    requests[0]?.routes.map((route): string => route.server),
    ['http://user:secret@217.71.230.5:3128/', 'socks5://217.71.230.1:1080'],
  );
});

void test('refuses a product the user does not track, though it exists', async (): Promise<void> => {
  const { useCase, requests, productId } = await createUseCase([
    proxy('socks5://217.71.230.1:1080', true, 4),
  ]);

  await assert.rejects(
    useCase.execute('9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33', productId),
    ProductNotFoundError,
  );
  assert.equal(requests.length, 0);
});

void test('refuses an unknown product and a missing route without queueing', async (): Promise<void> => {
  const empty = await createUseCase([proxy('socks5://217.71.230.1:1080', false, 0)]);

  await assert.rejects(empty.useCase.execute(userId, empty.productId), NoProxiesAvailableError);
  await assert.rejects(
    empty.useCase.execute(userId, '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33'),
    ProductNotFoundError,
  );

  assert.equal(empty.requests.length, 0);
  assert.equal((await empty.jobs.list({}, { page: 1, pageSize: 10 })).total, 0);
});

void test('marks the job failed if it cannot be queued', async (): Promise<void> => {
  const { useCase, jobs, productId } = await createUseCase(
    [proxy('socks5://217.71.230.1:1080', true, 1)],
    true,
  );

  await assert.rejects(useCase.execute(userId, productId), /redis is down/);
  const [job] = (await jobs.list({}, { page: 1, pageSize: 10 })).items;
  assert.equal(job?.snapshot.status, 'failed');
});

void test('names the city of the product in the job, for a marketplace that has cities, and only then', async (): Promise<void> => {
  const dns = {
    marketplace: 'dns',
    externalId: '0463bb2411a1d582',
    url: 'https://www.dns-shop.ru/product/0463bb2411a1d582/',
    cityId: '30b7c1f1-03fb-11dc-95ee-00151716f9f5',
    cityName: 'Иркутск',
  } as const;
  const { useCase, requests, productId } = await createUseCase(
    [proxy('socks5://217.71.230.1:1080', true, 4)],
    false,
    dns,
  );

  await useCase.execute(userId, productId);

  assert.deepEqual(requests[0]?.products, [
    { trackedProductId: productId, url: dns.url, cityId: dns.cityId },
  ]);
});
