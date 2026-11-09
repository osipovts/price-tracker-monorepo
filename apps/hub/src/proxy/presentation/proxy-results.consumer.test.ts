import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UnrecoverableError } from 'bullmq';
import { silentLogger } from 'logger';
import { QueueMessageParser } from 'queue-worker';

import { RecordJobEventUseCase } from '../../job/application/record-job-event.use-case.js';
import { RecordJobMessageUseCase } from '../../job/application/record-job-message.use-case.js';
import { JobEntity } from '../../job/domain/job.entity.js';
import { InMemoryJobRepositoryAdapter } from '../../job/infrastructure/in-memory-job-repository.adapter.js';
import type { AppConfigInterface } from '../../shared/application/app-config.interface.js';
import { RecordProxyChecksUseCase } from '../application/record-proxy-checks.use-case.js';
import { InMemoryProxyRepositoryAdapter } from '../infrastructure/in-memory-proxy-repository.adapter.js';
import { ProxyResultsConsumer } from './proxy-results.consumer.js';

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

void test('stores the checks of a source and ignores its completion message', async (): Promise<void> => {
  const repository = new InMemoryProxyRepositoryAdapter();
  const consumer = new ProxyResultsConsumer(
    new RecordProxyChecksUseCase(repository),
    new RecordJobMessageUseCase(new RecordJobEventUseCase(new InMemoryJobRepositoryAdapter())),
    new QueueMessageParser(silentLogger),
    config,
    silentLogger,
  );

  await consumer.handle({
    type: 'proxy_checks',
    jobId,
    source: 'github-free-proxy-list',
    checks: [
      {
        server: 'socks5://217.71.230.1:1080',
        alive: true,
        latencyMs: 250,
        country: 'RU',
        exitIp: '217.71.230.1',
        checkedAt: '2026-10-24T12:00:00.000Z',
      },
      {
        server: 'http://217.71.230.2:8080',
        alive: false,
        latencyMs: null,
        country: null,
        exitIp: null,
        checkedAt: '2026-10-24T12:00:00.000Z',
      },
    ],
  });

  const page = await repository.list({}, { page: 1, pageSize: 10 });
  assert.deepEqual(
    page.items.map((proxy): [string, boolean] => [proxy.snapshot.server, proxy.snapshot.alive]),
    [
      ['socks5://217.71.230.1:1080', true],
      ['http://217.71.230.2:8080', false],
    ],
  );
});

void test('rejects a malformed message for good', async (): Promise<void> => {
  const consumer = new ProxyResultsConsumer(
    new RecordProxyChecksUseCase(new InMemoryProxyRepositoryAdapter()),
    new RecordJobMessageUseCase(new RecordJobEventUseCase(new InMemoryJobRepositoryAdapter())),
    new QueueMessageParser(silentLogger),
    config,
    silentLogger,
  );

  await assert.rejects(consumer.handle({ type: 'proxy_checks', checks: 1 }), UnrecoverableError);
});

void test('tracks the progress of a proxy job until it is done', async (): Promise<void> => {
  const jobs = new InMemoryJobRepositoryAdapter();
  await jobs.save(
    JobEntity.queued(jobId, 'proxy_fetch', 'github-free-proxy-list', null, new Date(), null),
  );
  const consumer = new ProxyResultsConsumer(
    new RecordProxyChecksUseCase(new InMemoryProxyRepositoryAdapter()),
    new RecordJobMessageUseCase(new RecordJobEventUseCase(jobs)),
    new QueueMessageParser(silentLogger),
    config,
    silentLogger,
  );

  await consumer.handle({ type: 'job_started', jobId });
  await consumer.handle({
    type: 'job_progress',
    jobId,
    processed: 5,
    total: 20,
    succeeded: 2,
  });

  const running = await jobs.findById(jobId);
  assert.deepEqual(
    running && [running.snapshot.status, running.percent, running.snapshot.succeeded],
    ['running', 25, 2],
  );

  await consumer.handle({ type: 'job_failed', jobId, reason: 'Source down', willRetry: true });
  assert.equal((await jobs.findById(jobId))?.snapshot.status, 'retrying');

  await consumer.handle({ type: 'job_done', jobId });
  const done = await jobs.findById(jobId);
  assert.deepEqual(done && [done.snapshot.status, done.percent], ['completed', 100]);
});
