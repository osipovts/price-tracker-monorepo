import assert from 'node:assert/strict';
import { test } from 'node:test';

import { systemClock } from '../../shared/application/clock.port.js';
import { ProxyEntity } from '../domain/proxy.entity.js';
import { ProxyReputationEntity } from '../domain/proxy-reputation.entity.js';
import { InMemoryProxyRepositoryAdapter } from '../infrastructure/in-memory-proxy-repository.adapter.js';
import { InMemoryProxyReputationRepositoryAdapter } from '../infrastructure/in-memory-proxy-reputation-repository.adapter.js';
import { GetProxyStatsUseCase } from './get-proxy-stats.use-case.js';
import { ListBestProxyServersUseCase } from './list-best-proxy-servers.use-case.js';
import type { ProxyRepositoryPort } from './proxy-repository.port.js';
import type { ProxyReputationRepositoryPort } from './proxy-reputation-repository.port.js';

function statsOf(
  proxies: ProxyRepositoryPort,
  reputations: ProxyReputationRepositoryPort = new InMemoryProxyReputationRepositoryAdapter(),
): GetProxyStatsUseCase {
  return new GetProxyStatsUseCase(
    proxies,
    new ListBestProxyServersUseCase(proxies, reputations, systemClock, (): number => 0.25),
  );
}

function proxy(
  n: number,
  alive: boolean,
  latencyMs: number | null,
  disabled: boolean,
  checked: string,
  source = 'github-free-proxy-list',
): ProxyEntity {
  return new ProxyEntity({
    server: `socks5://217.71.230.${String(n)}:1080`,
    source,
    country: 'RU',
    exitIp: null,
    alive,
    latencyMs,
    checksTotal: 1,
    checksAlive: alive ? 1 : 0,
    lastCheckedAt: new Date(checked),
    lastSeenAt: new Date(checked),
    disabledAt: disabled ? new Date('2026-10-31T09:00:00Z') : null,
    credentials: null,
  });
}

void test('counts the proxies, the alive and the turned off, the mean latency of the alive and the last check, by source too', async (): Promise<void> => {
  const proxies = new InMemoryProxyRepositoryAdapter();
  await proxies.saveMany([
    proxy(1, true, 100, false, '2026-10-31T10:00:00Z'),
    proxy(2, true, 300, true, '2026-10-31T11:00:00Z'),
    proxy(3, false, null, false, '2026-10-31T08:00:00Z', 'proxifly'),
  ]);

  const { usable, ...stats } = await statsOf(proxies).execute();

  assert.deepEqual(stats, {
    total: 3,
    alive: 2,
    disabled: 1,
    averageLatencyMs: 200,
    lastCheckedAt: new Date('2026-10-31T11:00:00Z'),
    bySource: [
      { source: 'github-free-proxy-list', total: 2, alive: 2, disabled: 1 },
      { source: 'proxifly', total: 1, alive: 0, disabled: 0 },
    ],
  });
  // Only the alive one that is on goes to the workers of the marketplaces of Russia.
  assert.ok(usable.every(({ count }): boolean => count === 1));
});

void test('a proxy that rests for a marketplace is not usable for it, and is for the others', async (): Promise<void> => {
  const proxies = new InMemoryProxyRepositoryAdapter();
  const reputations = new InMemoryProxyReputationRepositoryAdapter();
  const server = 'socks5://217.71.230.1:1080';
  await proxies.saveMany([proxy(1, true, 100, false, '2026-10-31T10:00:00Z')]);
  const blocked = ProxyReputationEntity.fromAttempt({
    server,
    marketplace: 'ozon',
    status: 'challenge_required',
    httpStatus: null,
    stage: 'page',
    durationMs: null,
    attemptedAt: new Date(),
  });
  assert.ok(blocked);
  await reputations.saveMany([blocked]);

  const { usable } = await statsOf(proxies, reputations).execute();

  assert.equal(usable.find(({ marketplace }): boolean => marketplace === 'ozon')?.count, 0);
  assert.equal(usable.find(({ marketplace }): boolean => marketplace === 'dns')?.count, 1);
});

void test('has no mean latency and no last check with no proxies', async (): Promise<void> => {
  const { usable, ...stats } = await statsOf(new InMemoryProxyRepositoryAdapter()).execute();

  assert.deepEqual(stats, {
    total: 0,
    alive: 0,
    disabled: 0,
    averageLatencyMs: null,
    lastCheckedAt: null,
    bySource: [],
  });
  assert.ok(usable.every(({ count }): boolean => count === 0));
});
