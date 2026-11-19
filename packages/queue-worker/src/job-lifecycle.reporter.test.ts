import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UnrecoverableError } from 'bullmq';
import { silentLogger } from 'logger';
import type { JobLifecycleType } from 'queue-contract';
import { z } from 'zod';

import {
  formatFailureReason,
  JobLifecycleReporter,
  maxReasonLength,
} from './job-lifecycle.reporter.js';
import { QueueMessageParser } from './queue-message.parser.js';

const jobId = '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11';

function createReporter(published: JobLifecycleType[]): JobLifecycleReporter {
  return new JobLifecycleReporter((message): Promise<void> => {
    published.push(message);

    return Promise.resolve();
  }, silentLogger);
}

void test('reports the start and the end of a job', async (): Promise<void> => {
  const published: JobLifecycleType[] = [];

  await createReporter(published).run(jobId, false, (): Promise<void> => Promise.resolve());

  assert.deepEqual(published, [
    { type: 'job_started', jobId },
    { type: 'job_done', jobId },
  ]);
});

void test('reports a failure, tells whether it is retried and rethrows it', async (): Promise<void> => {
  const published: JobLifecycleType[] = [];

  await assert.rejects(
    createReporter(published).run(jobId, true, (): Promise<void> => {
      throw new Error('source down');
    }),
    /source down/,
  );

  assert.deepEqual(published, [
    { type: 'job_started', jobId },
    { type: 'job_failed', jobId, reason: 'source down', willRetry: true },
  ]);
});

void test('rejects a malformed message for good', (): void => {
  const parser = new QueueMessageParser(silentLogger);
  const schema = z.object({ jobId: z.uuid() });

  assert.deepEqual(parser.parse(schema, { jobId }, 'job'), { jobId });
  assert.throws((): unknown => parser.parse(schema, { jobId: 'nope' }, 'job'), UnrecoverableError);
});

void test('parses a job it is given, and publishes nothing for it', async (): Promise<void> => {
  const published: JobLifecycleType[] = [];

  const job = await createReporter(published).parse(
    new QueueMessageParser(silentLogger),
    z.object({ jobId: z.uuid(), count: z.number() }),
    { jobId, count: 2 },
    'test job',
  );

  assert.deepEqual(job, { jobId, count: 2 });
  assert.deepEqual(published, []);
});

void test('reports a malformed job that says whose it is as failed for good, and rejects it', async (): Promise<void> => {
  const published: JobLifecycleType[] = [];

  await assert.rejects(
    createReporter(published).parse(
      new QueueMessageParser(silentLogger),
      z.object({ jobId: z.uuid(), count: z.number() }),
      { jobId, count: 'two' },
      'test job',
    ),
    UnrecoverableError,
  );

  assert.deepEqual(published, [
    { type: 'job_failed', jobId, reason: 'Malformed test job', willRetry: false },
  ]);
});

void test('has nobody to tell about a malformed job that does not say whose it is', async (): Promise<void> => {
  const published: JobLifecycleType[] = [];

  await assert.rejects(
    createReporter(published).parse(
      new QueueMessageParser(silentLogger),
      z.object({ jobId: z.uuid() }),
      { jobId: 'not-a-uuid' },
      'test job',
    ),
    UnrecoverableError,
  );
  await assert.rejects(
    createReporter(published).parse(
      new QueueMessageParser(silentLogger),
      z.object({ jobId: z.uuid() }),
      'garbage',
      'test job',
    ),
    UnrecoverableError,
  );

  assert.deepEqual(published, []);
});

void test('keeps detailed reasons beyond 200 characters up to maxReasonLength and redacts URL credentials', async (): Promise<void> => {
  const published: JobLifecycleType[] = [];
  const longReason = `via http://user:secret@203.0.113.10:8080 failed: ${'x'.repeat(250)}`;

  await assert.rejects(
    createReporter(published).run(jobId, false, (): Promise<void> => {
      throw new Error(longReason);
    }),
  );

  const failed = published.find((message) => message.type === 'job_failed');
  assert.ok(failed !== undefined);
  assert.ok(failed.reason.length > 200);
  assert.ok(!failed.reason.includes('user:secret'));
  assert.ok(failed.reason.includes('http://***@203.0.113.10:8080'));
  assert.equal(formatFailureReason('a'.repeat(maxReasonLength + 50)).length, maxReasonLength);
});
