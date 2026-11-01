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
import { SaveHandbookCitiesUseCase } from '../application/save-handbook-cities.use-case.js';
import { InMemoryHandbookRepositoryAdapter } from '../infrastructure/in-memory-handbook-repository.adapter.js';
import { HandbookResultsConsumer } from './handbook-results.consumer.js';

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
const irkutsk = { id: '30b7c1f1-03fb-11dc-95ee-00151716f9f5', name: 'Иркутск', region: null };

function setup(): {
  consumer: HandbookResultsConsumer;
  handbooks: InMemoryHandbookRepositoryAdapter;
  jobs: InMemoryJobRepositoryAdapter;
} {
  const handbooks = new InMemoryHandbookRepositoryAdapter();
  const jobs = new InMemoryJobRepositoryAdapter();

  return {
    consumer: new HandbookResultsConsumer(
      new SaveHandbookCitiesUseCase(handbooks),
      new RecordJobMessageUseCase(new RecordJobEventUseCase(jobs)),
      new QueueMessageParser(silentLogger),
      config,
      silentLogger,
    ),
    handbooks,
    jobs,
  };
}

void test('keeps the cities a fetcher read, in place of the ones the handbook had', async (): Promise<void> => {
  const { consumer, handbooks } = setup();

  await consumer.handle({
    type: 'handbook_cities',
    jobId,
    handbook: 'dns-cities',
    cities: [irkutsk],
  });
  await consumer.handle({
    type: 'handbook_cities',
    jobId,
    handbook: 'dns-cities',
    cities: [{ id: 'b', name: 'Абакан', region: null }],
  });

  const stored = await handbooks.findCities('dns-cities');
  assert.deepEqual(stored?.cities, [{ id: 'b', name: 'Абакан', region: null }]);
});

void test('records the progress and the end of the job', async (): Promise<void> => {
  const { consumer, jobs } = setup();
  await jobs.save(JobEntity.queued(jobId, 'handbook_fetch', 'dns-cities', null, new Date(), null));

  await consumer.handle({ type: 'job_started', jobId });
  await consumer.handle({ type: 'job_progress', jobId, processed: 15, total: 30, succeeded: 15 });
  assert.equal((await jobs.findById(jobId))?.snapshot.processed, 15);

  await consumer.handle({ type: 'job_done', jobId });
  assert.equal((await jobs.findById(jobId))?.snapshot.status, 'completed');
});

void test('rejects a message that is not of the contract', async (): Promise<void> => {
  const { consumer } = setup();

  await assert.rejects(consumer.handle({ type: 'handbook_cities', jobId }), UnrecoverableError);
});
