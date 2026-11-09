import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ClockPort } from '../../shared/application/clock.port.js';
import { JobEntity } from '../domain/job.entity.js';
import { InMemoryJobRepositoryAdapter } from '../infrastructure/in-memory-job-repository.adapter.js';
import { GetJobStatsUseCase } from './get-job-stats.use-case.js';

const hour = 3_600_000;
const now = new Date('2026-10-31T12:00:00Z');
const clock: ClockPort = { now: (): Date => now };
const ago = (hours: number): Date => new Date(now.getTime() - hours * hour);

void test('counts the jobs of the last day by kind and status, the unfinished and the lost ones, and the ended price reads by the hour', async (): Promise<void> => {
  const jobs = new InMemoryJobRepositoryAdapter();
  const queued = (id: string, hours: number): JobEntity =>
    JobEntity.queued(
      `3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a${id}`,
      'proxy_fetch',
      'source',
      null,
      ago(hours),
      null,
    );
  await jobs.save(queued('11', 30).completed(ago(30)));
  await jobs.save(queued('12', 5).completed(ago(5)));
  await jobs.save(queued('13', 4).failed('proxies are down', false, ago(4)));
  await jobs.save(queued('14', 3).failed('redis is down', false, ago(3)));
  await jobs.save(queued('15', 2));
  await jobs.save(queued('16', 1).started(ago(1)));
  await jobs.save(queued('17', 30));
  await jobs.save(
    JobEntity.queued(
      '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a18',
      'price_fetch',
      'ozon',
      2,
      ago(3),
      null,
    ).completed(new Date(ago(2).getTime() + 10 * 60_000)),
  );

  const stats = await new GetJobStatsUseCase(jobs, clock).execute();

  assert.deepEqual(stats.lastDay, [
    { kind: 'proxy_fetch', queued: 1, running: 1, retrying: 0, completed: 1, failed: 2 },
    { kind: 'price_fetch', queued: 0, running: 0, retrying: 0, completed: 1, failed: 0 },
    { kind: 'handbook_fetch', queued: 0, running: 0, retrying: 0, completed: 0, failed: 0 },
  ]);
  // Queued 2 and 30 hours ago and still not done: lost.
  assert.deepEqual(stats.unfinished, { queued: 0, running: 1, retrying: 0, lost: 2 });
  assert.deepEqual(stats.priceJobsByHour, [{ hour: ago(2), completed: 1, failed: 0 }]);
});
