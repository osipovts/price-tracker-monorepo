import { expect, test } from 'vitest';

import {
  type ChartRowInterface,
  isRow,
  labelOf,
  paddedDomain,
  roundTicks,
  titleOf,
  toRows,
} from './chart-rows.type.js';
import type { PriceBucketInterface } from './price-series.type.js';

function bucket(hour: number, value: number | null, observed: boolean): PriceBucketInterface {
  return { start: new Date(2026, 10, 1, hour), value, observed };
}

/** The buckets of one line from what each has: a price read in it, a price carried (in brackets), or none. */
function line(...cells: Array<number | [number] | null>): PriceBucketInterface[] {
  return cells.map((cell, hour): PriceBucketInterface =>
    cell === null
      ? bucket(hour, null, false)
      : Array.isArray(cell)
        ? bucket(hour, cell[0], false)
        : bucket(hour, cell, true),
  );
}

function valuesOf(rows: ChartRowInterface[], key: string): Array<number | null | undefined> {
  return rows.map((row) => row.values[`a:${key}`]);
}

test('a segment is solid where a price was read since the point before, and dashed and flat where none was', () => {
  const rows = toRows([{ id: 'a', buckets: line(100, 120, [120], [120], 90) }]);

  expect(valuesOf(rows, 'solid:0')).toEqual([100, 120, null, null, null]);
  expect(valuesOf(rows, 'dashed:0')).toEqual([null, 120, 120, 120, null]);
  expect(valuesOf(rows, 'solid:1')).toEqual([null, null, null, 120, 90]);
  expect(valuesOf(rows, 'dashed:1')).toEqual([null, null, null, null, null]);
});

test('runs of a kind take turns on its two lines, so that two runs one segment apart do not join', () => {
  // Solid, dashed, solid, dashed, solid: the solid runs share no line with the run next to them.
  const rows = toRows([{ id: 'a', buckets: line(100, 110, [110], 130, [130], 150) }]);

  // The third solid run is back on the first line: the nulls between keep it apart from the first run.
  expect(valuesOf(rows, 'solid:0')).toEqual([100, 110, null, null, 130, 150]);
  expect(valuesOf(rows, 'solid:1')).toEqual([null, null, 110, 130, null, null]);
  expect(valuesOf(rows, 'dashed:0')).toEqual([null, 110, 110, null, null, null]);
  expect(valuesOf(rows, 'dashed:1')).toEqual([null, null, null, 130, 130, null]);
});

test('draws nothing to a point before the first price, and dots only the prices read', () => {
  const rows = toRows([{ id: 'a', buckets: line(null, 100, [100]) }]);

  expect(valuesOf(rows, 'solid:0')).toEqual([null, null, null]);
  expect(valuesOf(rows, 'dashed:0')).toEqual([null, 100, 100]);
  expect(valuesOf(rows, 'read')).toEqual([null, 100, null]);
  expect(valuesOf(rows, 'value')).toEqual([null, 100, 100]);
});

test('puts the lines of several products into the same rows, each under its own id', () => {
  const rows = toRows([
    { id: 'a', buckets: line(100, 110) },
    { id: 'b', buckets: line(200, [200]) },
  ]);

  expect(rows).toHaveLength(2);
  expect(rows.map((row) => Object.keys(row.cells))).toEqual([
    ['a', 'b'],
    ['a', 'b'],
  ]);
  expect(rows[1]?.values['b:dashed:0']).toBe(200);
  expect(rows[1]?.values['a:solid:0']).toBe(110);
  expect(new Set(rows.map((row) => row.key)).size).toBe(2);
});

test('keeps the lines off the edges of the chart, and lets the chart choose when there is no price', () => {
  expect(paddedDomain([[bucket(1, 1000, true)], [bucket(2, 2000, true)]])).toEqual([950, 2050]);
  expect(paddedDomain([[bucket(1, null, false)]])).toEqual(['auto', 'auto']);

  const [low, high] = paddedDomain([[bucket(1, 1000, true)]]);
  expect(Number(low)).toBeLessThan(1000);
  expect(Number(high)).toBeGreaterThan(1000);
});

test('gives the prices most of the height of the chart, the axis ending close to them', () => {
  const domain = paddedDomain([line(19_040_000, 19_520_000), line(20_500_000, 23_800_000)]);

  expect(domain).toEqual([18_802_000, 24_038_000]);
  expect(roundTicks(domain, 8)).toEqual([
    19_000_000, 20_000_000, 21_000_000, 22_000_000, 23_000_000, 24_000_000,
  ]);
});

test('marks the axis of prices at round steps within the domain', () => {
  expect(roundTicks([10_149_000, 12_211_400], 5)).toEqual([11_000_000, 12_000_000]);
  expect(roundTicks([4_500_000, 5_400_000], 5)).toEqual([
    4_500_000, 4_750_000, 5_000_000, 5_250_000,
  ]);
  expect(roundTicks(['auto', 'auto'], 5)).toEqual([]);
});

test('never marks the axis closer than a ruble', () => {
  expect(roundTicks([1000, 1050], 5)).toEqual([1000]);
});

test('labels a point by the moment it stands for: the end of the hour, the day, the Sunday of the week', () => {
  expect(labelOf(new Date(2026, 10, 1, 14), 'hour', 'ru')).toBe('15:00');
  expect(labelOf(new Date(2026, 10, 1), 'day', 'ru')).toBe('01 ноя');
  expect(labelOf(new Date(2026, 9, 26), 'week', 'ru')).toBe('01 ноя');
  expect(labelOf(new Date(2026, 0, 1), 'day', 'ru')).toBe('01 янв');
  expect(labelOf(new Date(2026, 0, 1), 'day', 'en')).toBe('Jan 01');
  expect(titleOf(new Date(2026, 9, 26), 'week', 'ru')).toBe('1 ноября 2026 г.');
  expect(titleOf(new Date(2026, 10, 1, 14), 'hour', 'ru')).toBe('01.11, 15:00');
});

test('takes for a row of the chart what has cells and a key', () => {
  expect(isRow({ key: 'a', start: new Date(), cells: {}, values: {} })).toBe(true);
  expect(isRow({ key: 'a' })).toBe(false);
  expect(isRow(null)).toBe(false);
  expect(isRow('row')).toBe(false);
});
