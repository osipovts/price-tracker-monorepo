import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ClockPort } from '../../shared/application/clock.port.js';
import { ProxyEntity } from '../domain/proxy.entity.js';
import type { ProxyAttemptInterface } from '../domain/proxy-attempt.interface.js';
import { InMemoryProxyRepositoryAdapter } from '../infrastructure/in-memory-proxy-repository.adapter.js';
import { InMemoryProxyReputationRepositoryAdapter } from '../infrastructure/in-memory-proxy-reputation-repository.adapter.js';
import { ListBestProxyServersUseCase } from './list-best-proxy-servers.use-case.js';
import { RecordProxyAttemptsUseCase } from './record-proxy-attempts.use-case.js';

const fast = 'socks5://217.71.230.1:1080';
const slow = 'socks5://217.71.230.2:1080';
const blocked = 'socks5://217.71.230.3:1080';

const attemptedAt = new Date('2026-11-03T08:00:00Z');

function proxy(server: string): ProxyEntity {
  return new ProxyEntity({
    server,
    source: 'github-free-proxy-list',
    country: 'RU',
    exitIp: null,
    alive: true,
    latencyMs: 100,
    checksTotal: 4,
    checksAlive: 4,
    lastCheckedAt: attemptedAt,
    lastSeenAt: attemptedAt,
    disabledAt: null,
    credentials: null,
  });
}

function attempt(
  server: string,
  status: ProxyAttemptInterface['status'],
  marketplace: ProxyAttemptInterface['marketplace'] = 'ozon',
): ProxyAttemptInterface {
  return { server, marketplace, status, httpStatus: null, attemptedAt };
}

async function setup(random: () => number = (): number => 0.25): Promise<{
  record: RecordProxyAttemptsUseCase;
  best: ListBestProxyServersUseCase;
  reputations: InMemoryProxyReputationRepositoryAdapter;
}> {
  const proxies = new InMemoryProxyRepositoryAdapter();
  await proxies.saveMany([proxy(slow), proxy(fast), proxy(blocked)]);
  const reputations = new InMemoryProxyReputationRepositoryAdapter();
  const clock: ClockPort = { now: (): Date => new Date(attemptedAt.getTime() + 1000) };

  return {
    record: new RecordProxyAttemptsUseCase(proxies, reputations),
    best: new ListBestProxyServersUseCase(proxies, reputations, clock, random),
    reputations,
  };
}

void test('a proxy the marketplace turned away is not given for it, and still is for another marketplace', async (): Promise<void> => {
  const { record, best } = await setup();

  await record.execute([attempt(blocked, 'challenge_required')]);

  assert.deepEqual(
    (await best.execute({ marketplace: 'ozon', limit: 5 })).includes(blocked),
    false,
  );
  assert.deepEqual((await best.execute({ marketplace: 'dns', limit: 5 })).includes(blocked), true);
});

void test('a proxy that read the marketplace goes before those that failed or were never tried', async (): Promise<void> => {
  const { record, best } = await setup();

  await record.execute([attempt(slow, 'network_error'), attempt(fast, 'success')]);

  assert.deepEqual(await best.execute({ marketplace: 'ozon', limit: 5 }), [fast, blocked]);
});

void test('the proxies go in another order from one job to the next', async (): Promise<void> => {
  let seed = 1;
  const { best } = await setup((): number => {
    // A linear congruential generator: a known sequence that looks random.
    seed = (seed * 48271) % 2147483647;

    return seed / 2147483647;
  });

  const orders = new Set<string>();
  for (let index = 0; index < 20; index += 1) {
    orders.add((await best.execute({ marketplace: 'ozon', limit: 3 })).join(' '));
  }

  assert.ok(orders.size > 1);
});

void test('the attempts through a proxy that is gone are not kept, nor those the proxy has no part in', async (): Promise<void> => {
  const { record, reputations } = await setup();

  await record.execute([
    attempt('socks5://217.71.230.9:1080', 'success'),
    attempt(fast, 'parse_error'),
    attempt(slow, 'success', 'dns'),
  ]);

  const kept = await reputations.findByServers(['socks5://217.71.230.9:1080', fast, slow]);
  assert.deepEqual(
    kept.map(({ snapshot }): string => `${snapshot.marketplace} ${snapshot.server}`),
    [`dns ${slow}`],
  );
});

void test('the attempts through one proxy count in order', async (): Promise<void> => {
  const { record, reputations } = await setup();

  await record.execute([attempt(fast, 'network_error'), attempt(fast, 'network_error')]);
  await record.execute([attempt(fast, 'network_error')]);

  const [reputation] = await reputations.findByServers([fast], 'ozon');
  assert.equal(reputation?.snapshot.failureStreak, 3);
});
