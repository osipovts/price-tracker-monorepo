import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { JobStatsInterface } from '../../job/application/index.js';
import type { ProductStatsInterface } from '../../product/application/index.js';
import type { ProxyStatsInterface } from '../../proxy/application/index.js';
import { GetDashboardUseCase } from './get-dashboard.use-case.js';

const now = new Date('2026-10-31T12:00:00Z');

const products: ProductStatsInterface = {
  products: 7,
  trackings: 9,
  groups: 4,
  marketplaces: [],
  readsByHour: [],
};

const proxies: ProxyStatsInterface = {
  total: 40,
  alive: 12,
  disabled: 2,
  averageLatencyMs: 310,
  lastCheckedAt: now,
  bySource: [],
  usable: [],
};

const jobs: JobStatsInterface = {
  lastDay: [{ kind: 'price_fetch', queued: 0, running: 0, retrying: 0, completed: 3, failed: 1 }],
  unfinished: { queued: 0, running: 1, retrying: 0, lost: 0 },
  priceJobsByHour: [],
};

void test('puts the figures of every context on one page, as of now', async (): Promise<void> => {
  const dashboard = await new GetDashboardUseCase(
    { execute: () => Promise.resolve({ total: 5, verified: 3, joinedLastDay: 1 }) },
    { execute: () => Promise.resolve(products) },
    { execute: () => Promise.resolve(proxies) },
    { execute: () => Promise.resolve(jobs) },
    { now: (): Date => now },
  ).execute();

  assert.deepEqual(dashboard, {
    generatedAt: now,
    users: { total: 5, verified: 3, joinedLastDay: 1 },
    products,
    proxies,
    jobs,
  });
});
