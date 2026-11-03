import assert from 'node:assert/strict';
import { test } from 'node:test';

import { silentLogger } from 'logger';
import { proxySourceSchema, type ProxySourceType } from 'queue-contract';

import type { GetJobActivityUseCase, JobActivityInterface } from '../../job/application/index.js';
import type { JobKindType } from '../../job/domain/job.entity.js';
import { InMemoryRateLimiterAdapter } from '../../shared/infrastructure/in-memory-rate-limiter.adapter.js';
import type { RefreshProxySourceUseCase } from '../application/refresh-proxy-source.use-case.js';
import {
  PeriodicProxyRefreshAdapter,
  type ProxyUpkeepInterface,
} from './periodic-proxy-refresh.adapter.js';

type RefreshType = Pick<RefreshProxySourceUseCase, 'execute'>;

const settings = { pauseMs: 600_000, pollMs: 10_000, maxCandidates: 150, probeTimeoutMs: 8000 };
const minute = 60_000;
/** Every source is queued on a run. */
const sourceCount = proxySourceSchema.options.length;

/** What the proxy jobs are doing, as the activity of the job context tells. */
function activityOf(
  state: JobActivityInterface,
): Pick<GetJobActivityUseCase, 'execute'> & { asked: JobKindType[] } {
  const asked: JobKindType[] = [];

  return {
    asked,
    execute: (kind): Promise<JobActivityInterface> => {
      asked.push(kind);

      return Promise.resolve(state);
    },
  };
}

const idle: JobActivityInterface = { active: false, lastFinishedAt: null };

function recording(failing?: ProxySourceType): {
  refresh: RefreshType;
  calls: Array<[ProxySourceType, number, number, string | null]>;
} {
  const calls: Array<[ProxySourceType, number, number, string | null]> = [];

  return {
    calls,
    refresh: {
      execute: (source, options, requestedBy): Promise<{ jobId: string }> => {
        if (source === failing) return Promise.reject(new Error('redis is down'));
        calls.push([source, options.maxCandidates, options.probeTimeoutMs, requestedBy]);

        return Promise.resolve({ jobId: 'job' });
      },
    },
  };
}

/** The upkeep of the stored proxies: nothing to drop and, unless told, nothing to check again. */
function upkeep(toRecheck: string[] = [], pruned: Date[] = []): ProxyUpkeepInterface {
  return {
    prune: {
      execute: (now): Promise<number> => {
        pruned.push(now);

        return Promise.resolve(0);
      },
    },
    recheck: { execute: (): Promise<string[]> => Promise.resolve(toRecheck) },
  };
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve): void => {
    setTimeout(resolve, ms);
  });

void test('queues every source with the settings when the hub starts, for no user', async (): Promise<void> => {
  const { refresh, calls } = recording();
  const adapter = new PeriodicProxyRefreshAdapter(
    refresh,
    activityOf(idle),
    new InMemoryRateLimiterAdapter(),
    upkeep(),
    settings,
    silentLogger,
  );

  adapter.onApplicationBootstrap();
  await wait(30);
  await adapter.onApplicationShutdown();

  assert.deepEqual(calls, [
    ['github-free-proxy-list', 150, 8000, null],
    ['proxifly', 150, 8000, null],
    ['proxyscrape', 150, 8000, null],
    ['geonode', 150, 8000, null],
    ['monosans', 150, 8000, null],
  ]);
});

void test('a source that cannot be queued does not keep the others from it', async (): Promise<void> => {
  const { refresh, calls } = recording('proxifly');
  const adapter = new PeriodicProxyRefreshAdapter(
    refresh,
    activityOf(idle),
    new InMemoryRateLimiterAdapter(),
    upkeep(),
    settings,
    silentLogger,
  );

  adapter.onApplicationBootstrap();
  await wait(30);
  await adapter.onApplicationShutdown();

  assert.deepEqual(
    calls.map(([source]): ProxySourceType => source),
    ['github-free-proxy-list', 'proxyscrape', 'geonode', 'monosans'],
  );
});

void test('repeats on every poll once the pause is over, until it shuts down', async (): Promise<void> => {
  const { refresh, calls } = recording();
  const adapter = new PeriodicProxyRefreshAdapter(
    refresh,
    activityOf({ active: false, lastFinishedAt: new Date(Date.now() - 60 * minute) }),
    new InMemoryRateLimiterAdapter(),
    upkeep(),
    { ...settings, pollMs: 50 },
    silentLogger,
  );

  adapter.onApplicationBootstrap();
  await wait(200);
  await adapter.onApplicationShutdown();

  // The window is shorter than the interval, so a run is allowed in each of them.
  assert.ok(calls.length >= 2 * sourceCount, `queued ${String(calls.length)} refreshes`);
  const stopped = calls.length;
  await wait(100);
  assert.equal(calls.length, stopped);
});

void test('of the instances of the hub that share a Redis only one queues in a window', async (): Promise<void> => {
  const shared = new InMemoryRateLimiterAdapter();
  const [first, second] = [recording(), recording()];
  const adapters = [first, second].map(
    ({ refresh }): PeriodicProxyRefreshAdapter =>
      new PeriodicProxyRefreshAdapter(
        refresh,
        activityOf(idle),
        shared,
        upkeep(),
        settings,
        silentLogger,
      ),
  );

  for (const adapter of adapters) adapter.onApplicationBootstrap();
  await wait(30);
  for (const adapter of adapters) await adapter.onApplicationShutdown();

  assert.equal(first.calls.length + second.calls.length, sourceCount);
});

void test('does nothing when the pause is 0', async (): Promise<void> => {
  const { refresh, calls } = recording();
  const adapter = new PeriodicProxyRefreshAdapter(
    refresh,
    activityOf(idle),
    new InMemoryRateLimiterAdapter(),
    upkeep(),
    { ...settings, pauseMs: 0 },
    silentLogger,
  );

  adapter.onApplicationBootstrap();
  await wait(30);
  await adapter.onApplicationShutdown();

  assert.equal(calls.length, 0);
});

void test('waits for the proxy jobs that are on their way, and for the pause after the last one ended', async (): Promise<void> => {
  const states: Array<[string, JobActivityInterface, number]> = [
    ['a job is on its way', { active: true, lastFinishedAt: null }, 0],
    [
      'the last job ended a minute ago',
      { active: false, lastFinishedAt: new Date(Date.now() - minute) },
      0,
    ],
    [
      'the last job ended long ago',
      { active: false, lastFinishedAt: new Date(Date.now() - 11 * minute) },
      sourceCount,
    ],
  ];

  for (const [, state, queued] of states) {
    const { refresh, calls } = recording();
    const activity = activityOf(state);
    const adapter = new PeriodicProxyRefreshAdapter(
      refresh,
      activity,
      new InMemoryRateLimiterAdapter(),
      upkeep(),
      settings,
      silentLogger,
    );

    adapter.onApplicationBootstrap();
    await wait(30);
    await adapter.onApplicationShutdown();

    assert.equal(calls.length, queued);
    assert.deepEqual(activity.asked, ['proxy_fetch']);
  }
});

void test('drops the expired proxies, then deals the ones to check again among the jobs, one share for each', async (): Promise<void> => {
  const shares: Array<[ProxySourceType, string[]]> = [];
  const pruned: Date[] = [];
  const adapter = new PeriodicProxyRefreshAdapter(
    {
      execute: (source, _options, _requestedBy, recheck): Promise<{ jobId: string }> => {
        shares.push([source, recheck ?? []]);

        return Promise.resolve({ jobId: 'job' });
      },
    },
    activityOf(idle),
    new InMemoryRateLimiterAdapter(),
    upkeep(['a', 'b', 'c', 'd', 'e', 'f'], pruned),
    settings,
    silentLogger,
  );

  adapter.onApplicationBootstrap();
  await wait(30);
  await adapter.onApplicationShutdown();

  assert.equal(pruned.length, 1);
  assert.deepEqual(shares, [
    ['github-free-proxy-list', ['a', 'f']],
    ['proxifly', ['b']],
    ['proxyscrape', ['c']],
    ['geonode', ['d']],
    ['monosans', ['e']],
  ]);
});

void test('queues the sources even when the upkeep of the stored proxies fails', async (): Promise<void> => {
  const { refresh, calls } = recording();
  const adapter = new PeriodicProxyRefreshAdapter(
    refresh,
    activityOf(idle),
    new InMemoryRateLimiterAdapter(),
    {
      prune: { execute: (): Promise<number> => Promise.reject(new Error('db is down')) },
      recheck: { execute: (): Promise<string[]> => Promise.resolve([]) },
    },
    settings,
    silentLogger,
  );

  adapter.onApplicationBootstrap();
  await wait(30);
  await adapter.onApplicationShutdown();

  assert.equal(calls.length, sourceCount);
});
