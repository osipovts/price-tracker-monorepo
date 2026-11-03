import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { silentLogger } from 'logger';
import { handbookSchema, type HandbookType } from 'queue-contract';

import { InMemoryRateLimiterAdapter } from '../../shared/infrastructure/in-memory-rate-limiter.adapter.js';
import type { RefreshHandbookUseCase } from '../application/refresh-handbook.use-case.js';
import { InMemoryHandbookRepositoryAdapter } from './in-memory-handbook-repository.adapter.js';
import { PeriodicHandbookRefreshAdapter } from './periodic-handbook-refresh.adapter.js';

const day = 24 * 60 * 60_000;
const settings = { maxAgeMs: 7 * day, checkIntervalMs: 60 * 60_000 };

function recording(): {
  refresh: Pick<RefreshHandbookUseCase, 'execute'>;
  calls: Array<[HandbookType, string | null]>;
} {
  const calls: Array<[HandbookType, string | null]> = [];

  return {
    calls,
    refresh: {
      execute: (handbook, requestedBy): Promise<{ jobId: string }> => {
        calls.push([handbook, requestedBy]);

        return Promise.resolve({ jobId: 'job' });
      },
    },
  };
}

const settle = (): Promise<void> =>
  new Promise((resolve): void => {
    setImmediate(resolve);
  });

void test('reads the handbooks that were never read when the hub starts, for no user', async (t: TestContext): Promise<void> => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.UTC(2026, 10, 1, 12) });
  const { refresh, calls } = recording();
  const adapter = new PeriodicHandbookRefreshAdapter(
    refresh,
    new InMemoryHandbookRepositoryAdapter(),
    new InMemoryRateLimiterAdapter(),
    settings,
    silentLogger,
  );

  adapter.onApplicationBootstrap();
  await settle();
  await adapter.onApplicationShutdown();

  assert.deepEqual(
    calls,
    handbookSchema.options.map((handbook): [HandbookType, null] => [handbook, null]),
  );
});

void test('leaves a handbook that is fresh alone, and reads it again once it is older than the maximum age', async (t: TestContext): Promise<void> => {
  const readAt = Date.UTC(2026, 10, 1, 12);
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: readAt + 6 * day });
  const handbooks = new InMemoryHandbookRepositoryAdapter();
  for (const handbook of handbookSchema.options)
    await handbooks.saveCities(handbook, [], new Date(readAt));
  const { refresh, calls } = recording();
  const adapter = new PeriodicHandbookRefreshAdapter(
    refresh,
    handbooks,
    new InMemoryRateLimiterAdapter(),
    settings,
    silentLogger,
  );

  adapter.onApplicationBootstrap();
  await settle();
  assert.equal(calls.length, 0, 'six days old');

  t.mock.timers.tick(2 * day);
  await settle();
  assert.equal(calls.length, handbookSchema.options.length, 'eight days old');

  await adapter.onApplicationShutdown();
});

void test('of the instances of the hub that share a Redis only one asks for each handbook, and not again within the check interval', async (t: TestContext): Promise<void> => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.UTC(2026, 10, 1, 12) });
  const shared = new InMemoryRateLimiterAdapter();
  const [first, second] = [recording(), recording()];
  const adapters = [first, second].map(
    ({ refresh }): PeriodicHandbookRefreshAdapter =>
      new PeriodicHandbookRefreshAdapter(
        refresh,
        new InMemoryHandbookRepositoryAdapter(),
        shared,
        settings,
        silentLogger,
      ),
  );

  for (const adapter of adapters) adapter.onApplicationBootstrap();
  await settle();
  for (const adapter of adapters) await adapter.onApplicationShutdown();

  assert.equal(first.calls.length + second.calls.length, handbookSchema.options.length);
});
