import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { silentLogger } from 'logger';
import {
  DnsReferenceParser,
  marketplaceDefaultCities,
  OzonReferenceParser,
  ResolveProductReferenceUseCase,
} from 'product-reference';

import { GetAccountUseCase } from '../account/application/get-account.use-case.js';
import { InMemoryUserRepositoryAdapter } from '../account/infrastructure/in-memory-user-repository.adapter.js';
import { AccessGuard } from '../auth/presentation/access.guard.js';
import { SessionCookieParser } from '../auth/presentation/session-cookie.parser.js';
import { ResolveAuthSessionUseCase } from '../auth-session/application/resolve-auth-session.use-case.js';
import { StartAuthSessionUseCase } from '../auth-session/application/start-auth-session.use-case.js';
import { InMemoryAuthSessionRepositoryAdapter } from '../auth-session/infrastructure/in-memory-auth-session-repository.adapter.js';
import { ListHandbookCitiesUseCase } from '../handbook/application/list-handbook-cities.use-case.js';
import { RefreshHandbookUseCase } from '../handbook/application/refresh-handbook.use-case.js';
import { SaveHandbookCitiesUseCase } from '../handbook/application/save-handbook-cities.use-case.js';
import { SearchCitiesUseCase } from '../handbook/application/search-cities.use-case.js';
import { InMemoryHandbookRepositoryAdapter } from '../handbook/infrastructure/in-memory-handbook-repository.adapter.js';
import { CitiesController } from '../handbook/presentation/cities.controller.js';
import { HandbooksController } from '../handbook/presentation/handbooks.controller.js';
import { GetJobUseCase } from '../job/application/get-job.use-case.js';
import { ScheduleJobUseCase } from '../job/application/index.js';
import type { JobQueuePort } from '../job/application/job-queue.port.js';
import { ListJobsUseCase } from '../job/application/list-jobs.use-case.js';
import { RecordJobEventUseCase } from '../job/application/record-job-event.use-case.js';
import { InMemoryJobRepositoryAdapter } from '../job/infrastructure/in-memory-job-repository.adapter.js';
import { JobsController } from '../job/presentation/jobs.controller.js';
import { AddProductUseCase } from '../product/application/add-product.use-case.js';
import { ChoosePriceRoutesUseCase } from '../product/application/choose-price-routes.use-case.js';
import { GetProductThumbnailUrlUseCase } from '../product/application/get-product-thumbnail-url.use-case.js';
import { ListPriceHistoryUseCase } from '../product/application/list-price-history.use-case.js';
import { ListProductsUseCase } from '../product/application/list-products.use-case.js';
import { RemoveProductUseCase } from '../product/application/remove-product.use-case.js';
import { RequestPriceObservationUseCase } from '../product/application/request-price-observation.use-case.js';
import { InMemoryPriceObservationRepositoryAdapter } from '../product/infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../product/infrastructure/in-memory-tracked-product-repository.adapter.js';
import { ProductsController } from '../product/presentation/products.controller.js';
import { AddManualProxyUseCase } from '../proxy/application/add-manual-proxy.use-case.js';
import { DeleteAllProxiesUseCase } from '../proxy/application/delete-all-proxies.use-case.js';
import { DeleteProxyUseCase } from '../proxy/application/delete-proxy.use-case.js';
import { ListBestProxyServersUseCase } from '../proxy/application/index.js';
import { ListProxiesUseCase } from '../proxy/application/list-proxies.use-case.js';
import { RefreshProxySourceUseCase } from '../proxy/application/refresh-proxy-source.use-case.js';
import { SetProxyDisabledUseCase } from '../proxy/application/set-proxy-disabled.use-case.js';
import { ProxyEntity } from '../proxy/domain/proxy.entity.js';
import { InMemoryProxyRepositoryAdapter } from '../proxy/infrastructure/in-memory-proxy-repository.adapter.js';
import { ProxiesController } from '../proxy/presentation/proxies.controller.js';
import { ProxySourcesController } from '../proxy/presentation/proxy-sources.controller.js';
import { APP_CONFIG, type AppConfigInterface } from '../shared/application/app-config.interface.js';
import { LOGGER } from '../shared/application/logger.port.js';
import { InMemoryObjectStorageAdapter } from '../shared/infrastructure/in-memory-object-storage.adapter.js';
import { InMemoryRateLimiterAdapter } from '../shared/infrastructure/in-memory-rate-limiter.adapter.js';
import { ApplicationErrorFilter } from '../shared/presentation/application-error.filter.js';
import { HttpLoggingInterceptor } from '../shared/presentation/http-logging.interceptor.js';

const proxies = new InMemoryProxyRepositoryAdapter();
const products = new InMemoryTrackedProductRepositoryAdapter();
const observations = new InMemoryPriceObservationRepositoryAdapter();
const jobs = new InMemoryJobRepositoryAdapter();

const queued: unknown[] = [];
const handbooks = new InMemoryHandbookRepositoryAdapter();
const irkutskId = '30b7c1f1-03fb-11dc-95ee-00151716f9f5';
const queue: JobQueuePort = {
  enqueueProxyFetch: (request): Promise<void> => {
    queued.push(request);

    return Promise.resolve();
  },
  enqueuePriceFetch: (request): Promise<void> => {
    queued.push(request);

    return Promise.resolve();
  },
  enqueueHandbookFetch: (request): Promise<void> => {
    queued.push(request);

    return Promise.resolve();
  },
};

const scheduleJob = new ScheduleJobUseCase(queue, jobs);
const requestObservation = new RequestPriceObservationUseCase(
  products,
  new ChoosePriceRoutesUseCase(new ListBestProxyServersUseCase(proxies), 3),
  scheduleJob,
  30000,
);

const operatorApiKey = 'operator-key-of-at-least-16-chars';
const userId = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';
const authPolicy = { idleTtlMs: 60_000, absoluteTtlMs: 120_000 };
const authSessions = new InMemoryAuthSessionRepositoryAdapter();
const config: AppConfigInterface = {
  databaseUrl: 'postgresql://localhost:5432/hub',
  redisUrl: 'redis://localhost:6379',
  port: 3000,
  priceProxyCount: 5,
  priceTimeoutMs: 60000,
  linkExpandTimeoutMs: 15000,
  priceRefreshAfterMs: 0,
  priceRefreshPollMs: 60_000,
  priceProxyLagMs: 30_000,
  priceRefreshBatchSize: 200,
  proxyRefreshPauseMinutes: 10,
  proxyRefreshMaxCandidates: 200,
  proxyRefreshProbeTimeoutMs: 10000,
  authSessionIdleTtlMs: 60_000,
  authSessionAbsoluteTtlMs: 120_000,
  authCookieSecure: false,
  smtpUrl: null,
  mailFrom: 'hub@example.com',
  emailVerificationTtlMs: 86_400_000,
  authVerificationResendMaxAttempts: 1000,
  productsPerUserMax: 100,
  productGroupItemsMax: 5,
  productAddMaxAttempts: 1000,
  productAddWindowMs: 60_000,
  authSessionPurgeIntervalMs: 60_000,
  authRateLimitWindowMs: 60_000,
  authLoginMaxAttempts: 1000,
  authLoginMaxAttemptsPerEmail: 1000,
  authLoginMaxAttemptsPerIp: 1000,
  authRegisterMaxAttempts: 1000,
  trustProxy: 0,
  publicUrl: 'http://localhost:3000',
  authAllowedOrigins: [],
  authSuccessRedirect: '/auth/me',
  authFailureRedirect: null,
  googleOauth: null,
  githubOauth: null,
  adminEmails: [],
  adminUiDir: null,
  s3: null,
  clientUiDir: null,
  operatorApiKey,
  logLevel: 'error',
};

let app: INestApplication;
let baseUrl: string;
/** What a signed-in user who is also the operator sends: the session cookie and the API key. */
let credentials: Record<string, string>;
/** The cookie of another user, with no right of the operator. */
let otherCookie: string;

before(async (): Promise<void> => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      ProxiesController,
      ProxySourcesController,
      ProductsController,
      JobsController,
      CitiesController,
      HandbooksController,
    ],
    providers: [
      { provide: APP_PIPE, useClass: StandardSchemaValidationPipe },
      { provide: APP_FILTER, useClass: ApplicationErrorFilter },
      { provide: APP_INTERCEPTOR, useClass: HttpLoggingInterceptor },
      { provide: LOGGER, useValue: silentLogger },
      { provide: APP_GUARD, useClass: AccessGuard },
      {
        provide: GetAccountUseCase,
        useValue: new GetAccountUseCase(new InMemoryUserRepositoryAdapter()),
      },
      { provide: APP_CONFIG, useValue: config },
      {
        provide: ResolveAuthSessionUseCase,
        useValue: new ResolveAuthSessionUseCase(authSessions, authPolicy),
      },
      SessionCookieParser,
      { provide: GetJobUseCase, useValue: new GetJobUseCase(jobs) },
      { provide: ListJobsUseCase, useValue: new ListJobsUseCase(jobs) },
      { provide: RefreshProxySourceUseCase, useValue: new RefreshProxySourceUseCase(scheduleJob) },
      {
        provide: ListProxiesUseCase,
        useValue: new ListProxiesUseCase(proxies),
      },
      {
        provide: AddProductUseCase,
        useValue: new AddProductUseCase(
          new ResolveProductReferenceUseCase([new OzonReferenceParser(), new DnsReferenceParser()]),
          products,
          observations,
          requestObservation,
          new InMemoryRateLimiterAdapter(),
          { maxProducts: 100, add: { limit: 1000, windowMs: 60_000 } },
          undefined,
          undefined,
          {
            find: (_marketplace, cityId): Promise<{ name: string } | null> =>
              Promise.resolve(cityId === irkutskId ? { name: 'Иркутск' } : null),
          },
        ),
      },
      { provide: SearchCitiesUseCase, useValue: new SearchCitiesUseCase(handbooks) },
      { provide: ListHandbookCitiesUseCase, useValue: new ListHandbookCitiesUseCase(handbooks) },
      {
        provide: RefreshHandbookUseCase,
        useValue: new RefreshHandbookUseCase(
          new ListBestProxyServersUseCase(proxies),
          scheduleJob,
          2,
        ),
      },
      { provide: ListProductsUseCase, useValue: new ListProductsUseCase(products, observations) },
      {
        provide: RemoveProductUseCase,
        useValue: new RemoveProductUseCase(products, new InMemoryObjectStorageAdapter(false)),
      },
      {
        provide: GetProductThumbnailUrlUseCase,
        useValue: new GetProductThumbnailUrlUseCase(new InMemoryObjectStorageAdapter(false)),
      },
      { provide: AddManualProxyUseCase, useValue: new AddManualProxyUseCase(proxies) },
      { provide: SetProxyDisabledUseCase, useValue: new SetProxyDisabledUseCase(proxies) },
      { provide: DeleteProxyUseCase, useValue: new DeleteProxyUseCase(proxies) },
      { provide: DeleteAllProxiesUseCase, useValue: new DeleteAllProxiesUseCase(proxies) },
      { provide: RequestPriceObservationUseCase, useValue: requestObservation },
      {
        provide: ListPriceHistoryUseCase,
        useValue: new ListPriceHistoryUseCase(products, observations),
      },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.listen(0);
  baseUrl = await app.getUrl();

  const { token } = await new StartAuthSessionUseCase(authSessions, authPolicy).execute({
    userId,
    userAgent: null,
    ip: null,
  });
  credentials = { cookie: `session=${token}`, authorization: `Bearer ${operatorApiKey}` };

  const other = await new StartAuthSessionUseCase(authSessions, authPolicy).execute({
    userId: '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33',
    userAgent: null,
    ip: null,
  });
  otherCookie = `session=${other.token}`;
});

after(async (): Promise<void> => {
  await app.close();
});

type InitType = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> };

async function call(
  path: string,
  init: InitType = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...credentials, ...init.headers },
  });
  const text = await response.text();
  const body: unknown = text === '' ? {} : JSON.parse(text);
  assert.ok(typeof body === 'object' && body !== null);

  return { status: response.status, body: Object.fromEntries(Object.entries(body)) };
}

function post(body?: unknown): InitType {
  return {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  };
}

const productUrl = 'https://www.ozon.ru/product/4775581891/';

async function addProduct(url = productUrl): Promise<{ id: string; jobId: string | null }> {
  const added = await call('/products', post({ url }));
  assert.ok(added.status === 201 || added.status === 200);
  const jobId = added.body['jobId'];

  return { id: String(added.body['id']), jobId: typeof jobId === 'string' ? jobId : null };
}

void test('tracks a product though there is no way to read its price yet', async (): Promise<void> => {
  const added = await call('/products', post({ url: productUrl }));

  assert.equal(added.status, 201);
  assert.equal(added.body['jobId'], null);
  assert.equal(queued.length, 0);
});

void test('queues a proxy source refresh with defaults, with and without a body', async (): Promise<void> => {
  const withoutBody = await call('/proxy-sources/github-free-proxy-list/refresh', post());
  assert.equal(withoutBody.status, 202);
  assert.equal(typeof withoutBody.body['jobId'], 'string');

  const withBody = await call(
    '/proxy-sources/github-free-proxy-list/refresh',
    post({ maxCandidates: 10 }),
  );
  assert.equal(withBody.status, 202);
  assert.deepEqual(
    queued.slice(-2).map((request) => request),
    [expectRequest(withoutBody.body['jobId'], 200), expectRequest(withBody.body['jobId'], 10)],
  );

  assert.equal((await call('/proxy-sources/unknown/refresh', post())).status, 400);
  assert.equal(
    (await call('/proxy-sources/github-free-proxy-list/refresh', post({ maxCandidates: 0 })))
      .status,
    400,
  );
});

function expectRequest(jobId: unknown, maxCandidates: number): unknown {
  return {
    jobId,
    source: 'github-free-proxy-list',
    maxCandidates,
    recheck: [],
    probeTimeoutMs: 10000,
  };
}

void test('lists proxies with pagination and validates the query', async (): Promise<void> => {
  await proxies.saveMany(
    [1, 2, 3].map(
      (index) =>
        new ProxyEntity({
          server: `socks5://217.71.230.${String(index)}:1080`,
          source: 'github-free-proxy-list',
          country: 'RU',
          exitIp: null,
          alive: index !== 3,
          latencyMs: 100 * index,
          checksTotal: 1,
          checksAlive: index !== 3 ? 1 : 0,
          lastCheckedAt: new Date('2026-10-24T12:00:00.000Z'),
          lastSeenAt: new Date('2026-10-24T12:00:00.000Z'),
          disabledAt: null,
          credentials: null,
        }),
    ),
  );

  // With no `alive`, both the alive and the dead are listed.
  assert.equal((await call('/proxies?pageSize=1')).body['total'], 3);

  const alive = await call('/proxies?alive=true&pageSize=1');
  assert.equal(alive.status, 200);
  assert.equal(alive.body['total'], 2);
  assert.equal(alive.body['pageSize'], 1);
  assert.deepEqual(alive.body['items'], [
    {
      server: 'socks5://217.71.230.1:1080',
      source: 'github-free-proxy-list',
      country: 'RU',
      exitIp: null,
      alive: true,
      latencyMs: 100,
      successRate: 1,
      checksTotal: 1,
      lastCheckedAt: '2026-10-24T12:00:00.000Z',
      disabled: false,
    },
  ]);

  assert.equal((await call('/proxies?alive=false')).body['total'], 1);
  assert.equal((await call('/proxies?country=US')).body['total'], 0);
  assert.equal((await call('/proxies?pageSize=1000')).status, 400);
  assert.equal((await call('/proxies?country=ru')).status, 400);
});

void test('tracks a product once whatever the link and lists it with its newest price', async (): Promise<void> => {
  const first = await call(
    '/products',
    post({ url: 'https://www.ozon.ru/product/asus-4775581891/?sh=share' }),
  );
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, {
    id: first.body['id'],
    marketplace: 'ozon',
    externalId: '4775581891',
    url: productUrl,
    cityId: null,
    cityName: null,
    lastStatus: null,
    lastCheckedAt: null,
    // The schedule is off in this test.
    nextCheckAt: null,
    thumbnailUrl: null,
    jobId: null,
  });

  const created = await call('/products', post({ url: 'https://ozon.ru/product/1/' }));
  assert.equal(created.status, 201);

  const list = await call('/products?pageSize=10');
  assert.equal(list.status, 200);
  assert.equal(list.body['total'], 2);

  const items: unknown = list.body['items'];
  assert.ok(Array.isArray(items));
  // The newest product comes first; nothing has been read yet.
  assert.deepEqual(
    items.map((item: unknown): unknown =>
      typeof item === 'object' && item !== null && 'url' in item && 'latest' in item
        ? [item.url, item.latest]
        : item,
    ),
    [
      ['https://www.ozon.ru/product/1/', null],
      [productUrl, null],
    ],
  );
});

void test('queues the read of the first price when a product is added, and serves an empty history meanwhile', async (): Promise<void> => {
  const url = 'https://www.ozon.ru/product/9000/';
  const { id, jobId } = await addProduct(url);
  assert.ok(jobId !== null);
  assert.deepEqual(queued.at(-1), {
    jobId,
    routes: [{ server: 'socks5://217.71.230.1:1080' }, { server: 'socks5://217.71.230.2:1080' }],
    products: [{ trackedProductId: id, url }],
    timeoutMs: 30000,
  });
  const queuedBefore = queued.length;

  // Adding it again does not queue it again.
  assert.equal((await addProduct(url)).jobId, null);
  assert.equal(queued.length, queuedBefore);

  const history = await call(`/products/${id}/prices`);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body, {
    product: {
      id,
      marketplace: 'ozon',
      externalId: '9000',
      url,
      cityId: null,
      cityName: null,
      lastStatus: null,
      lastCheckedAt: null,
      nextCheckAt: null,
      thumbnailUrl: null,
    },
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
});

void test('rejects bad links, unknown and malformed product ids', async (): Promise<void> => {
  assert.equal((await call('/products', post({ url: 'not a url' }))).status, 400);
  assert.equal((await call('/products', post({ url: 'https://example.com/item/1' }))).status, 400);
  assert.equal((await call('/products/nope/prices')).status, 400);
  const unknown = '/products/9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33/prices';
  assert.equal((await call(unknown)).status, 404);
});

void test('documents the endpoints and their zod schemas in Swagger', (): void => {
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Hub').build());
  assert.deepEqual(Object.keys(document.paths).toSorted(), [
    '/handbooks/{handbook}',
    '/handbooks/{handbook}/refresh',
    '/jobs',
    '/jobs/{id}',
    '/marketplaces/{marketplace}/cities',
    '/products',
    '/products/{id}',
    '/products/{id}/prices',
    '/proxies',
    '/proxies/all',
    '/proxy-sources/{source}/refresh',
  ]);

  assert.ok(document.paths['/jobs/{id}']?.get?.responses['200']);

  const prices = document.paths['/products/{id}/prices']?.get;
  assert.deepEqual(
    prices?.parameters
      ?.map((parameter) => ('name' in parameter ? parameter.name : '$ref'))
      .toSorted(),
    ['id', 'page', 'pageSize'],
  );

  const proxiesGet = document.paths['/proxies']?.get;
  assert.deepEqual(
    proxiesGet?.parameters
      ?.map((parameter) => ('name' in parameter ? parameter.name : '$ref'))
      .toSorted(),
    ['alive', 'country', 'disabled', 'page', 'pageSize'],
  );
  assert.ok(proxiesGet.responses['200']);

  const add = document.paths['/products']?.post;
  assert.deepEqual(Object.keys(add?.responses ?? {}).toSorted(), [
    '200',
    '201',
    '400',
    '403',
    '429',
  ]);
  assert.ok(add?.requestBody);
  assert.ok(document.paths['/products']?.get?.responses['200']);
  assert.equal(document.paths['/products/{id}/prices']?.post, undefined);
});

void test('the job reports its progress', async (): Promise<void> => {
  const { id: productId, jobId } = await addProduct('https://www.ozon.ru/product/9100/');
  assert.ok(jobId !== null);

  const queuedJob = await call(`/jobs/${jobId}`);
  assert.equal(queuedJob.status, 200);
  assert.equal(queuedJob.body['status'], 'queued');
  assert.equal(queuedJob.body['percent'], 0);
  assert.equal(queuedJob.body['kind'], 'price_fetch');
  assert.equal(queuedJob.body['subject'], productId);

  // A job id is no key to the job: another user does not see it.
  assert.equal((await call(`/jobs/${jobId}`, { headers: { cookie: otherCookie } })).status, 404);

  const events = new RecordJobEventUseCase(jobs);
  await events.execute({
    type: 'progress',
    jobId,
    at: new Date(),
    progress: { processed: 1, total: 1, succeeded: 1 },
  });
  await events.execute({ type: 'completed', jobId, at: new Date() });

  const done = await call(`/jobs/${jobId}`);
  assert.equal(done.body['status'], 'completed');
  assert.equal(done.body['percent'], 100);
  assert.equal(typeof done.body['finishedAt'], 'string');

  const listed = await call('/jobs?kind=price_fetch&status=completed');
  assert.equal(listed.body['total'], 1);
  assert.equal((await call('/jobs?status=unknown')).status, 400);
  assert.equal((await call('/jobs/9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33')).status, 404);
});

const userRoutes: Array<[string, string]> = [
  ['GET', '/products'],
  ['POST', '/products'],
  ['GET', '/marketplaces/dns/cities'],
  ['GET', '/products/3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11/prices'],
  ['DELETE', '/products/3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11'],
  ['GET', '/jobs/3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11'],
];

const operatorRoutes: Array<[string, string]> = [
  ['GET', '/jobs'],
  ['GET', '/proxies'],
  ['PATCH', '/proxies?server=socks5%3A%2F%2F203.0.113.50%3A1080'],
  ['DELETE', '/proxies?server=socks5%3A%2F%2F203.0.113.50%3A1080'],
  ['POST', '/proxy-sources/github-free-proxy-list/refresh'],
  ['POST', '/handbooks/dns-cities/refresh'],
  ['GET', '/handbooks/dns-cities'],
];

async function statusOf(
  [method, path]: [string, string],
  headers: Record<string, string>,
): Promise<number> {
  return (await fetch(`${baseUrl}${path}`, { method, headers })).status;
}

void test('every route is closed to the anonymous', async (): Promise<void> => {
  for (const route of [...userRoutes, ...operatorRoutes]) {
    assert.equal(await statusOf(route, {}), 401, route.join(' '));
  }
});

void test('the routes of the users take the cookie and no key, those of the operator the key and no cookie', async (): Promise<void> => {
  for (const route of userRoutes) {
    assert.equal(
      await statusOf(route, { authorization: credentials['authorization'] ?? '' }),
      401,
      route.join(' '),
    );
  }

  for (const route of operatorRoutes) {
    // A signed-in user who is no administrator is known, and forbidden.
    assert.equal(
      await statusOf(route, { cookie: credentials['cookie'] ?? '' }),
      403,
      route.join(' '),
    );
  }
});

void test('a product is tracked per user: the others do not see it, and join it by adding the same link', async (): Promise<void> => {
  const { id } = await addProduct();
  const other = { headers: { cookie: otherCookie } };

  assert.equal((await call('/products', other)).body['total'], 0);
  assert.equal((await call(`/products/${id}/prices`, other)).status, 404);
  assert.equal((await call(`/products/${id}/prices`, { method: 'POST', ...other })).status, 404);

  const joined = await call('/products', {
    ...post({ url: productUrl }),
    headers: {
      cookie: otherCookie,
      'content-type': 'application/json',
    },
  });
  assert.equal(joined.status, 201);
  assert.equal(joined.body['id'], id);
  assert.equal((await call('/products', other)).body['total'], 1);
  assert.equal((await call(`/products/${id}/prices`, other)).status, 200);
});

void test('stops tracking a product: it goes for good with its last tracker, and not before', async (): Promise<void> => {
  const { id } = await addProduct();
  await call('/products', {
    ...post({ url: productUrl }),
    headers: { cookie: otherCookie, 'content-type': 'application/json' },
  });
  const remove = (cookie: string): Promise<Response> =>
    fetch(`${baseUrl}/products/${id}`, { method: 'DELETE', headers: { cookie } });

  assert.equal((await remove(credentials['cookie'] ?? '')).status, 204);
  assert.equal((await remove(credentials['cookie'] ?? '')).status, 404);
  assert.equal((await call(`/products/${id}/prices`)).status, 404);
  assert.equal(
    (await call(`/products/${id}/prices`, { headers: { cookie: otherCookie } })).status,
    200,
  );

  assert.equal((await remove(otherCookie)).status, 204);
  assert.equal(
    (await call(`/products/${id}/prices`, { headers: { cookie: otherCookie } })).status,
    404,
  );
  assert.equal((await call('/products/nope', { method: 'DELETE' })).status, 400);
});

void test('an administrator turns a proxy off and on, sees the ones that are off, and deletes one', async (): Promise<void> => {
  const server = 'socks5://203.0.113.50:1080';
  await proxies.saveMany([
    new ProxyEntity({
      server,
      source: 'github-free-proxy-list',
      country: 'RU',
      exitIp: null,
      alive: true,
      latencyMs: 80,
      checksTotal: 2,
      checksAlive: 2,
      lastCheckedAt: new Date('2026-10-24T12:00:00.000Z'),
      lastSeenAt: new Date('2026-10-24T12:00:00.000Z'),
      disabledAt: null,
      credentials: null,
    }),
  ]);
  const query = `server=${encodeURIComponent(server)}`;
  const servers = async (filter: string): Promise<unknown[]> => {
    const items: unknown = (await call(`/proxies?pageSize=100&${filter}`)).body['items'];
    assert.ok(Array.isArray(items));

    return items.map((item: unknown): unknown =>
      typeof item === 'object' && item !== null && 'server' in item
        ? [item.server, 'disabled' in item && item.disabled]
        : item,
    );
  };

  assert.equal(
    (await call(`/proxies?${query}`, { ...post({ disabled: true }), method: 'PATCH' })).status,
    204,
  );
  assert.deepEqual(await servers('disabled=true'), [[server, true]]);
  assert.equal(
    (await servers('disabled=false')).some(
      (item): boolean => Array.isArray(item) && item[0] === server,
    ),
    false,
  );

  assert.equal(
    (await call(`/proxies?${query}`, { ...post({ disabled: false }), method: 'PATCH' })).status,
    204,
  );
  assert.deepEqual(await servers('disabled=true'), []);

  assert.equal((await call(`/proxies?${query}`, { method: 'DELETE' })).status, 204);
  assert.equal((await call(`/proxies?${query}`, { method: 'DELETE' })).status, 404);
  assert.equal(
    (await call(`/proxies?${query}`, { ...post({ disabled: true }), method: 'PATCH' })).status,
    404,
  );
  assert.equal((await call('/proxies?server=not-a-proxy', { method: 'DELETE' })).status, 400);
  assert.equal(
    (await call(`/proxies?${query}`, { ...post({ disabled: 'yes' }), method: 'PATCH' })).status,
    400,
  );
});

void test('an operator adds a proxy with credentials by hand: they are never listed, only given to the workers', async (): Promise<void> => {
  const server = 'http://217.71.230.77:3128';
  const added = await call('/proxies', post({ server: 'http://user:p%40ss@217.71.230.77:3128' }));
  assert.equal(added.status, 204);

  const listed = JSON.stringify((await call('/proxies?pageSize=100')).body);
  assert.ok(listed.includes(server));
  assert.equal(listed.includes('p%40ss') || listed.includes('p@ss'), false);

  const [stored] = await proxies.findByServers([server]);
  assert.ok(stored);
  assert.equal(stored.snapshot.source, 'manual');
  assert.deepEqual(stored.snapshot.credentials, { username: 'user', password: 'p@ss' });
  assert.equal(stored.routeUrl, 'http://user:p%40ss@217.71.230.77:3128/');

  assert.equal(
    (await call('/proxies', post({ server: 'socks5://u:p@217.71.230.78:1080' }))).status,
    400,
  );
  assert.equal((await call('/proxies', post({ server: 'http://10.0.0.1:3128' }))).status, 400);
});

void test('tracks a product of DNS in the city asked for, in the default city without one, and refuses an unknown city', async (): Promise<void> => {
  const url = 'https://www.dns-shop.ru/product/0463bb2411a1d582/156-noutbuk-asus/';

  const byDefault = await call('/products', post({ url }));
  const asked = await call('/products', post({ url, cityId: irkutskId }));
  const unknown = await call('/products', post({ url, cityId: 'nowhere' }));
  const ozon = await call('/products', post({ url: productUrl, cityId: irkutskId }));

  assert.equal(byDefault.body['cityId'], marketplaceDefaultCities.dns?.id);
  assert.equal(byDefault.body['cityName'], 'Москва');
  assert.equal(asked.status, 201);
  assert.equal(asked.body['cityId'], irkutskId);
  assert.equal(asked.body['cityName'], 'Иркутск');
  assert.notEqual(asked.body['id'], byDefault.body['id']);
  assert.equal(unknown.status, 400);
  assert.equal(ozon.body['cityId'], null);
  assert.equal(ozon.body['cityName'], null);
});

void test('a user searches the cities of DNS by a part of the name, and asks no city of a marketplace that has none', async (): Promise<void> => {
  await new SaveHandbookCitiesUseCase(handbooks).execute('dns-cities', [
    { id: irkutskId, name: 'Иркутск', region: 'Иркутская область' },
    { id: 'b', name: 'Москва', region: null },
  ]);

  const found = await call('/marketplaces/dns/cities?query=%D0%B8%D1%80%D0%BA');
  const all = await call('/marketplaces/dns/cities?limit=1');

  assert.equal(found.status, 200);
  assert.deepEqual(found.body['items'], [
    { id: irkutskId, name: 'Иркутск', region: 'Иркутская область' },
  ]);
  assert.equal(Array.isArray(all.body['items']) && all.body['items'].length, 1);
  assert.equal((await call('/marketplaces/ozon/cities')).status, 404);
  assert.equal((await call('/marketplaces/dns/cities?limit=0')).status, 400);
});

void test('the operator queues the read of a handbook through the proxies, and the job is theirs to follow', async (): Promise<void> => {
  const accepted = await call('/handbooks/dns-cities/refresh', post());

  assert.equal(accepted.status, 202);
  const request = queued.at(-1);
  assert.ok(typeof request === 'object' && request !== null && 'handbook' in request);
  assert.equal(request.handbook, 'dns-cities');
  assert.ok(
    'proxies' in request &&
      Array.isArray(request.proxies) &&
      request.proxies.every((proxy) => typeof proxy === 'string'),
  );
  assert.equal((await call('/handbooks/unknown/refresh', post())).status, 400);
});

void test('the operator looks at the cities a handbook keeps, a page at a time, with the time they were read', async (): Promise<void> => {
  await new SaveHandbookCitiesUseCase(handbooks).execute('dns-cities', [
    { id: irkutskId, name: 'Иркутск', region: 'Иркутская область' },
    { id: 'b', name: 'Москва', region: null },
    { id: 'c', name: 'Ангарск', region: 'Иркутская область' },
  ]);

  const page = await call('/handbooks/dns-cities?pageSize=2&page=1&query=%D0%B8%D1%80%D0%BA');

  assert.equal(page.status, 200);
  assert.equal(page.body['total'], 2);
  assert.equal(page.body['pageSize'], 2);
  assert.equal(typeof page.body['fetchedAt'], 'string');
  assert.deepEqual(page.body['items'], [
    { id: irkutskId, name: 'Иркутск', region: 'Иркутская область' },
    { id: 'c', name: 'Ангарск', region: 'Иркутская область' },
  ]);
  assert.equal((await call('/handbooks/unknown')).status, 400);
});
