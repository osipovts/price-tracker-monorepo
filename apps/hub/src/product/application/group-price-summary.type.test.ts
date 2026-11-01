import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PriceObservationInterface } from '../domain/price-observation.interface.js';
import { summarizeGroupPrices } from './group-price-summary.type.js';

const now = new Date('2026-11-02T12:00:00Z');
const hoursAgo = (hours: number): Date => new Date(now.getTime() - hours * 3_600_000);
const products = [
  { id: 'oz', marketplace: 'ozon' as const },
  { id: 'dn', marketplace: 'dns' as const },
];

let counter = 0;
function seen(
  productId: string,
  hours: number,
  amountMinor: number | null,
  availability: PriceObservationInterface['availability'] = 'in_stock',
): PriceObservationInterface {
  counter += 1;

  return {
    id: String(counter),
    trackedProductId: productId,
    jobId: String(counter),
    title: 't',
    observedAt: hoursAgo(hours),
    availability,
    prices: amountMinor === null ? [] : [{ amountMinor, currency: 'RUB' }],
    exitIp: null,
  };
}

function summarize(
  observations: PriceObservationInterface[],
  period: '24h' | '7d' | '30d' = '24h',
): ReturnType<typeof summarizeGroupPrices> {
  return summarizeGroupPrices({ products, observations, period, now });
}

void test('a group without observations has no prices', () => {
  assert.deepEqual(summarize([]), { current: null, min: null, max: null, highlighted: false });
});

void test('the current price is the cheapest of the newest reads that are in stock', () => {
  const summary = summarize([
    seen('oz', 5, 900),
    seen('oz', 1, 1000),
    seen('dn', 2, 950),
    seen('dn', 0.5, 1100, 'out_of_stock'),
  ]);

  assert.deepEqual(summary.current, {
    marketplace: 'ozon',
    amountMinor: 1000,
    observedAt: hoursAgo(1),
  });
});

void test('a product whose newest read is out of stock gives no current price, whatever it showed before', () => {
  const summary = summarize([seen('oz', 3, 800), seen('oz', 1, 800, 'out_of_stock')]);

  assert.equal(summary.current, null);
});

void test('the lowest and the highest price leave out the newest read of every product and the ones out of stock', () => {
  const summary = summarize([
    seen('oz', 10, 1200),
    seen('oz', 6, 700, 'out_of_stock'),
    seen('oz', 1, 100),
    seen('dn', 8, 1000),
    seen('dn', 0.5, 50),
  ]);

  assert.deepEqual(summary.min, { marketplace: 'dns', amountMinor: 1000, observedAt: hoursAgo(8) });
  assert.deepEqual(summary.max, {
    marketplace: 'ozon',
    amountMinor: 1200,
    observedAt: hoursAgo(10),
  });
});

void test('the period bounds the lowest and the highest price', () => {
  const observations = [seen('oz', 100, 500), seen('oz', 30, 900), seen('oz', 1, 1000)];

  assert.equal(summarize(observations, '24h').min, null);
  assert.equal(summarize(observations, '7d').min?.amountMinor, 500);
  assert.equal(summarize(observations, '7d').max?.amountMinor, 900);
});

void test('of equal prices the newer one is told', () => {
  const summary = summarize([
    seen('oz', 9, 800),
    seen('dn', 4, 800),
    seen('dn', 0.5, 900),
    seen('oz', 1, 900),
  ]);

  assert.equal(summary.min?.marketplace, 'dns');
});

void test('the current price is highlighted when it is not above the lowest price of the period', () => {
  const lower = summarize([seen('oz', 5, 1200), seen('oz', 1, 1000)]);
  const equal = summarize([seen('oz', 5, 1000), seen('oz', 1, 1000)]);
  const higher = summarize([seen('oz', 5, 900), seen('oz', 1, 1000)]);
  const unknown = summarize([seen('oz', 1, 1000)]);

  assert.deepEqual(
    [lower, equal, higher, unknown].map((summary) => summary.highlighted),
    [true, true, false, false],
  );
});
