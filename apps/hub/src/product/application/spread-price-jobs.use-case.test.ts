import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SpreadPriceJobsUseCase } from './spread-price-jobs.use-case.js';

const lag = 30_000;
const a = { server: 'socks5://217.71.230.1:1080' };
const b = { server: 'socks5://217.71.230.2:1080' };
const c = { server: 'socks5://217.71.230.3:1080' };
const start = new Date('2026-11-01T10:00:00Z');
const later = (ms: number): Date => new Date(start.getTime() + ms);

void test('starts the jobs that run together on different proxies, without a delay', (): void => {
  const spread = new SpreadPriceJobsUseCase(lag);

  const slots = [1, 2, 3].map(() => spread.execute('ozon', [a, b, c], start));

  assert.deepEqual(
    slots.map(({ routes }) => routes[0]?.server),
    [a.server, b.server, c.server],
  );
  assert.deepEqual(
    slots.map(({ delayMs }) => delayMs),
    [0, 0, 0],
  );
});

void test('keeps the other routes behind the first one, in their order', (): void => {
  const spread = new SpreadPriceJobsUseCase(lag);
  spread.execute('ozon', [a, b, c], start);

  assert.deepEqual(spread.execute('ozon', [a, b, c], start).routes, [b, a, c]);
});

void test('puts the jobs of one proxy a lag apart when there is no other', (): void => {
  const spread = new SpreadPriceJobsUseCase(lag);
  const direct = { server: null };

  const slots = [1, 2, 3].map(() => spread.execute('ozon', [a, direct], start));

  assert.deepEqual(
    slots.map(({ delayMs }) => delayMs),
    [0, lag, 2 * lag],
  );
  assert.deepEqual(
    slots.map(({ routes }) => routes),
    [
      [a, direct],
      [a, direct],
      [a, direct],
    ],
  );
});

void test('counts the lag from the moment of the job, and forgets a proxy that is free again', (): void => {
  const spread = new SpreadPriceJobsUseCase(lag);
  spread.execute('ozon', [a], start);

  assert.equal(spread.execute('ozon', [a], later(10_000)).delayMs, 20_000);
  assert.equal(spread.execute('ozon', [a], later(5 * lag)).delayMs, 0);
});

void test('keeps the marketplaces apart: one proxy may serve two of them at once', (): void => {
  const spread = new SpreadPriceJobsUseCase(lag);
  spread.execute('ozon', [a], start);

  assert.equal(spread.execute('dns', [a], start).delayMs, 0);
});

void test('leaves a job without routes as it is', (): void => {
  assert.deepEqual(new SpreadPriceJobsUseCase(lag).execute('ozon', [], start), {
    routes: [],
    delayMs: 0,
  });
});

void test('spaces jobs on the direct route when no proxy is present', (): void => {
  const spread = new SpreadPriceJobsUseCase(lag);
  const direct = { server: null };

  assert.deepEqual(
    [1, 2].map(() => spread.execute('ozon', [direct], start)),
    [
      { routes: [direct], delayMs: 0 },
      { routes: [direct], delayMs: lag },
    ],
  );
});
