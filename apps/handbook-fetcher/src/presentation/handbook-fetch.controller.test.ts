import assert from 'node:assert/strict';
import { test } from 'node:test';

import { silentLogger } from 'logger';
import type { HandbookFetchResultType } from 'queue-contract';
import { JobLifecycleReporter, QueueMessageParser } from 'queue-worker';

import type { FetchCitiesUseCase } from '../application/fetch-cities.use-case.js';
import { HandbookFetchController } from './handbook-fetch.controller.js';

const jobId = '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11';
const job = { jobId, handbook: 'dns-cities', proxies: ['socks5://217.71.230.1:1080'] };
const irkutsk = { id: '30b7c1f1-03fb-11dc-95ee-00151716f9f5', name: 'Иркутск', region: null };

function createController(
  execute: FetchCitiesUseCase['execute'],
  published: HandbookFetchResultType[],
): HandbookFetchController {
  const publish = (message: HandbookFetchResultType): Promise<void> => {
    published.push(message);

    return Promise.resolve();
  };

  return new HandbookFetchController(
    { 'dns-cities': { execute }, 'wildberries-cities': { execute } },
    new QueueMessageParser(silentLogger),
    new JobLifecycleReporter(publish, silentLogger),
    publish,
  );
}

void test('reports the letters read, and then the cities, of a job from start to finish', async (): Promise<void> => {
  const published: HandbookFetchResultType[] = [];
  const routes: string[] = [];
  const controller = createController(async (given, _signal, listener) => {
    routes.push(...given.map((route) => route.server));
    await listener.onProgress(0, 2);
    await listener.onProgress(2, 2);

    return [irkutsk];
  }, published);

  await controller.handle(job, new AbortController().signal);

  assert.deepEqual(routes, ['socks5://217.71.230.1:1080']);
  assert.deepEqual(published, [
    { type: 'job_started', jobId },
    { type: 'job_progress', jobId, processed: 0, total: 2, succeeded: 0 },
    { type: 'job_progress', jobId, processed: 2, total: 2, succeeded: 2 },
    { type: 'handbook_cities', jobId, handbook: 'dns-cities', cities: [irkutsk] },
    { type: 'job_done', jobId },
  ]);
});

void test('leaves out a route that is not safe to connect through', async (): Promise<void> => {
  const routes: string[] = [];
  const controller = createController((given): Promise<never[]> => {
    routes.push(...given.map((route) => route.server));

    return Promise.resolve([]);
  }, []);

  await controller.handle(
    { ...job, proxies: ['socks5://127.0.0.1:1080', 'socks5://217.71.230.2:1080'] },
    new AbortController().signal,
  );

  assert.deepEqual(routes, ['socks5://217.71.230.2:1080']);
});

void test('reports a failing read as a failed job and tells whether it is retried', async (): Promise<void> => {
  const published: HandbookFetchResultType[] = [];
  const controller = createController(
    (): Promise<never> => Promise.reject(new Error('no route')),
    published,
  );

  await assert.rejects(controller.handle(job, new AbortController().signal, true));

  const failure = published.at(-1);
  assert.ok(failure?.type === 'job_failed');
  assert.equal(failure.reason, 'no route');
  assert.equal(failure.willRetry, true);
  assert.equal(
    published.some((message): boolean => message.type === 'handbook_cities'),
    false,
  );
});

void test('rejects a malformed job', async (): Promise<void> => {
  const controller = createController((): Promise<never[]> => Promise.resolve([]), []);

  await assert.rejects(controller.handle({ jobId: 'nope' }, new AbortController().signal), {
    name: 'UnrecoverableError',
  });
});
