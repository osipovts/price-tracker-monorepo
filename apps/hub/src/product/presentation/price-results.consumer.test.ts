import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UnrecoverableError } from 'bullmq';
import { silentLogger } from 'logger';
import { QueueMessageParser } from 'queue-worker';

import { RecordJobEventUseCase } from '../../job/application/record-job-event.use-case.js';
import { RecordJobMessageUseCase } from '../../job/application/record-job-message.use-case.js';
import { InMemoryJobRepositoryAdapter } from '../../job/infrastructure/in-memory-job-repository.adapter.js';
import type { AppConfigInterface } from '../../shared/application/app-config.interface.js';
import { noProxyAttempts, noThumbnails } from '../application/add-product-defaults.type.js';
import { ListPriceHistoryUseCase } from '../application/list-price-history.use-case.js';
import { RecordPriceResultUseCase } from '../application/record-price-result.use-case.js';
import { InMemoryPriceObservationRepositoryAdapter } from '../infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import { PriceResultsConsumer } from './price-results.consumer.js';

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
  priceRefreshCohortMs: 600_000,
  proxyRefreshPauseMinutes: 10,
  proxyRefreshMaxCandidates: 200,
  proxyRefreshProbeTimeoutMs: 10000,
  authSessionIdleTtlMs: 60_000,
  authSessionAbsoluteTtlMs: 120_000,
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
  operatorApiKey: null,
  authCookieSecure: false,
  logLevel: 'error',
};

const jobId = '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11';

const userId = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';

async function setup(): Promise<{
  consumer: PriceResultsConsumer;
  history: ListPriceHistoryUseCase;
  productId: string;
}> {
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const observations = new InMemoryPriceObservationRepositoryAdapter();
  const { product } = await products.add({
    marketplace: 'ozon',
    externalId: '4775581891',
    url: 'https://www.ozon.ru/product/4775581891/',
    cityId: null,
    cityName: null,
  });
  await products.subscribe(userId, product.snapshot.id);

  return {
    consumer: new PriceResultsConsumer(
      new RecordPriceResultUseCase(products, observations, noThumbnails, noProxyAttempts),
      new RecordJobMessageUseCase(new RecordJobEventUseCase(new InMemoryJobRepositoryAdapter())),
      new QueueMessageParser(silentLogger),
      config,
      silentLogger,
    ),
    history: new ListPriceHistoryUseCase(products, observations),
    productId: product.snapshot.id,
  };
}

void test('stores the snapshot of the attempt that read the product', async (): Promise<void> => {
  const { consumer, history, productId } = await setup();

  await consumer.handle({
    type: 'product_result',
    jobId,
    trackedProductId: productId,
    status: 'partial',
    attempts: [
      { proxy: 'socks5://217.71.230.1:1080', result: { status: 'network_error' } },
      {
        proxy: 'socks5://217.71.230.2:1080',
        result: {
          status: 'partial',
          exitIp: '217.71.230.2',
          snapshot: {
            title: 'Notebook',
            observedAt: '2026-10-24T12:00:00.000Z',
            prices: [{ amountMinor: 18673000, currency: 'RUB' }],
            availability: 'in_stock',
          },
        },
      },
    ],
  });

  const [observation] = (await history.execute(userId, productId, { page: 1, pageSize: 10 })).page
    .items;
  assert.equal(observation?.exitIp, '217.71.230.2');
  assert.equal(observation.prices[0]?.amountMinor, 18673000);
});

void test('ignores job messages and rejects malformed ones for good', async (): Promise<void> => {
  const { consumer } = await setup();

  await consumer.handle({ type: 'job_done', jobId });
  await assert.rejects(consumer.handle({ type: 'product_result' }), UnrecoverableError);
});
