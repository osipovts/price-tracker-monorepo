import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { type Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { silentLogger } from 'logger';

import { QueueWorkerRunner } from './queue-worker.runner.js';

/** Needs a Redis: set TEST_REDIS_URL to run it (never one with data that matters). */
const redisUrl = process.env['TEST_REDIS_URL'];
const skip = redisUrl === undefined ? 'TEST_REDIS_URL is not set' : false;

function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject): void => {
    const started = Date.now();
    const timer = setInterval((): void => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('Timed out'));
      }
    }, 20);
  });
}

void test(
  'a stop waits for a job that ends in time, and asks one that does not to stop',
  { skip },
  async (): Promise<void> => {
    assert.ok(redisUrl !== undefined);
    const jobsQueue = `jobs-${randomUUID()}`;
    const jobs = new Queue(jobsQueue, { connection: { url: redisUrl } });
    const runner = new QueueWorkerRunner(
      { redisUrl, jobsQueue, concurrency: 1, cancelAfterMs: 300 },
      silentLogger,
    );
    let aborted = false;
    let started = false;
    runner.start(async (_data, signal): Promise<void> => {
      started = true;
      // A job that would run for minutes, and stops only when it is asked to.
      await new Promise<void>((resolve): void => {
        signal.addEventListener(
          'abort',
          (): void => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      });
    });
    await jobs.add('job', { jobId: randomUUID() });
    await until((): boolean => started);

    const stopping = Date.now();
    await runner.close();

    assert.equal(aborted, true);
    assert.ok(Date.now() - stopping < 5000);
    await jobs.close();
  },
);

void test(
  'a stop does not ask a job to stop that ends before the time is up',
  { skip },
  async (): Promise<void> => {
    assert.ok(redisUrl !== undefined);
    const jobsQueue = `jobs-${randomUUID()}`;
    const jobs = new Queue(jobsQueue, { connection: { url: redisUrl } });
    const runner = new QueueWorkerRunner(
      { redisUrl, jobsQueue, concurrency: 1, cancelAfterMs: 5000 },
      silentLogger,
    );
    let aborted = false;
    let finished = false;
    let started = false;
    runner.start(async (_data, signal): Promise<void> => {
      started = true;
      signal.addEventListener(
        'abort',
        (): void => {
          aborted = true;
        },
        { once: true },
      );
      await new Promise((resolve): void => {
        setTimeout(resolve, 200);
      });
      finished = true;
    });
    await jobs.add('job', { jobId: randomUUID() });
    await until((): boolean => started);

    await runner.close();

    assert.equal(finished, true);
    assert.equal(aborted, false);
    await jobs.close();
  },
);

void test(
  'a job the queue fails before the handler sees it, as one that stalled too often, is reported failed',
  { skip },
  async (): Promise<void> => {
    assert.ok(redisUrl !== undefined);
    const jobsQueue = `jobs-${randomUUID()}`;
    const resultsQueue = `results-${randomUUID()}`;
    const jobs = new Queue(jobsQueue, { connection: { url: redisUrl } });
    const results = new Queue(resultsQueue, { connection: { url: redisUrl } });
    const redis = new Redis(redisUrl);
    const jobId = randomUUID();
    await jobs.add('job', { jobId }, { jobId, attempts: 3 });
    // What the queue writes on a job that stalled more often than it allows.
    await redis.hset(jobs.toKey(jobId), 'defa', 'job stalled more than allowable limit');
    const runner = new QueueWorkerRunner(
      { redisUrl, jobsQueue, resultsQueue, concurrency: 1 },
      silentLogger,
    );
    let handled = false;
    runner.start((): Promise<void> => {
      handled = true;

      return Promise.resolve();
    });

    let reported: Job[] = [];
    for (const started = Date.now(); reported.length === 0 && Date.now() - started < 10_000;) {
      reported = await results.getJobs(['wait']);
      await new Promise((resolve): void => {
        setTimeout(resolve, 50);
      });
    }
    await runner.close();
    await Promise.all([jobs.close(), results.close(), redis.quit()]);

    assert.equal(handled, false);
    assert.deepEqual(
      reported.map((job): unknown => job.data),
      [
        {
          type: 'job_failed',
          jobId,
          reason: 'job stalled more than allowable limit',
          willRetry: false,
        },
      ],
    );
  },
);
