import { expect, test } from 'vitest';

import { isRow, labelOf, paddedDomain, titleOf, toRows } from './chart-rows.type.js';
import type { PriceBucketInterface } from './price-series.type.js';

function bucket(hour: number, value: number | null, observed: boolean): PriceBucketInterface {
  return {
    start: new Date(2026, 10, 1, hour),
    value,
    observed,
    min: observed ? value : null,
    max: observed ? value : null,
    last: observed ? value : null,
    average: observed ? value : null,
  };
}

test('draws solid where prices were observed, and dashed over a gap with the points beside it', () => {
  const rows = toRows([
    {
      id: 'a',
      buckets: [
        bucket(1, 100, true),
        bucket(2, 100, true),
        bucket(3, 100, false),
        bucket(4, 120, true),
        bucket(5, 120, true),
      ],
    },
  ]);

  expect(rows.map((row) => row.cells['a']?.solid)).toEqual([100, 100, null, 120, 120]);
  expect(rows.map((row) => row.cells['a']?.dashed)).toEqual([null, 100, 100, 120, null]);
  expect(new Set(rows.map((row) => row.key)).size).toBe(5);
});

test('puts the lines of several products into the same rows', () => {
  const rows = toRows([
    { id: 'a', buckets: [bucket(1, 100, true), bucket(2, 110, true)] },
    { id: 'b', buckets: [bucket(1, 90, true), bucket(2, 95, false)] },
  ]);

  expect(rows).toHaveLength(2);
  expect(rows.map((row) => Object.keys(row.cells))).toEqual([
    ['a', 'b'],
    ['a', 'b'],
  ]);
  expect(rows[1]?.cells['b']?.solid).toBeNull();
});

test('keeps the lines off the edges of the chart, and lets the axis choose without a price', () => {
  expect(paddedDomain([[bucket(1, 1000, true)], [bucket(2, 2000, true)]])).toEqual([900, 2100]);
  expect(paddedDomain([[bucket(1, null, false)]])).toEqual(['auto', 'auto']);
  // One price alone still gets room on both sides.
  const [low, high] = paddedDomain([[bucket(1, 1000, true)]]);
  expect(Number(low)).toBeLessThan(1000);
  expect(Number(high)).toBeGreaterThan(1000);
});

test('labels the axis by the time of day for hours, and by the date for days', () => {
  const start = new Date(2026, 10, 1, 14, 5);

  expect(labelOf(start, 'hour', 'en')).toMatch(/2:05|14:05/);
  expect(labelOf(start, 'day', 'en')).toBe('11/01');
  expect(titleOf(start, 'day', 'en')).toContain('2026');
  expect(titleOf(start, 'hour', 'en')).toMatch(/11\/01/);
});

test('takes for a row of the chart what has cells and a key', () => {
  expect(isRow({ key: 'a', start: new Date(), cells: {} })).toBe(true);
  expect(isRow({ key: 'a' })).toBe(false);
  expect(isRow(null)).toBe(false);
  expect(isRow('row')).toBe(false);
});
