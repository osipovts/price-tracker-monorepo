import { expect, test } from 'vitest';

import { buildPriceSeries, pointDate, type PricePointInterface } from './price-series.type.js';

const now = new Date(2026, 9, 31, 12, 30);

function at(hour: number, minute: number, amountMinor: number, day = 31): PricePointInterface {
  return { observedAt: new Date(2026, 9, day, hour, minute), amountMinor };
}

test('a point is the last price read in its hour, the last in time and not in the order given', () => {
  const series = buildPriceSeries(
    [at(12, 5, 100_00), at(12, 20, 140_00), at(12, 10, 120_00)],
    'hour',
    3,
    now,
  );

  expect(series).toEqual([
    { start: new Date(2026, 9, 31, 10, 0), value: null, observed: false },
    { start: new Date(2026, 9, 31, 11, 0), value: null, observed: false },
    { start: new Date(2026, 9, 31, 12, 0), value: 140_00, observed: true },
  ]);
});

test('an hour with no price read keeps the one of the point before, and says it was not observed', () => {
  const series = buildPriceSeries([at(10, 40, 90_00)], 'hour', 4, now);

  expect(series.map((bucket): number | null => bucket.value)).toEqual([null, 90_00, 90_00, 90_00]);
  expect(series.map((bucket): boolean => bucket.observed)).toEqual([false, true, false, false]);
});

test('the last price before the chart carries into its first point', () => {
  const series = buildPriceSeries([at(5, 0, 75_00, 28)], 'day', 2, now);

  expect(series.map((bucket): number | null => bucket.value)).toEqual([75_00, 75_00]);
  expect(series.every((bucket): boolean => !bucket.observed)).toBe(true);
});

test('days are counted in the time of the browser, today last', () => {
  const series = buildPriceSeries(
    [at(23, 59, 50_00, 29), at(0, 1, 60_00, 30), at(9, 0, 70_00, 30)],
    'day',
    3,
    now,
  );

  expect(series.map((bucket): number | null => bucket.value)).toEqual([50_00, 70_00, 70_00]);
  expect(series.map((bucket): boolean => bucket.observed)).toEqual([true, true, false]);
  expect(series[2]?.start).toEqual(new Date(2026, 9, 31, 0, 0));
});

test('weeks run from Monday to Sunday, this week last', () => {
  // 31.10.2026 is a Saturday: its week started on Monday the 26th.
  const series = buildPriceSeries(
    [at(23, 0, 80_00, 25), at(0, 30, 85_00, 26), at(9, 0, 90_00, 31)],
    'week',
    2,
    now,
  );

  expect(series.map((bucket): Date => bucket.start)).toEqual([
    new Date(2026, 9, 19),
    new Date(2026, 9, 26),
  ]);
  expect(series.map((bucket): number | null => bucket.value)).toEqual([80_00, 90_00]);
});

test('a week that starts on Sunday is the one of the Monday before it', () => {
  const sunday = new Date(2026, 10, 1, 18, 0);
  const [week] = buildPriceSeries([], 'week', 1, sunday);

  expect(week?.start).toEqual(new Date(2026, 9, 26));
});

test('without any price there is nothing to draw', () => {
  const series = buildPriceSeries([], 'hour', 2, now);

  expect(series.map((bucket): number | null => bucket.value)).toEqual([null, null]);
});

test('the point of an hour is its end, of a day the day, of a week its Sunday', () => {
  expect(pointDate(new Date(2026, 9, 31, 14, 0), 'hour')).toEqual(new Date(2026, 9, 31, 15, 0));
  expect(pointDate(new Date(2026, 9, 31), 'day')).toEqual(new Date(2026, 9, 31));
  expect(pointDate(new Date(2026, 9, 26), 'week')).toEqual(new Date(2026, 10, 1));
});
