import { expect, test } from 'vitest';

import { jobRows, lastHours, readRows } from './hour-rows.type.js';

const now = new Date('2026-11-10T12:40:00Z').getTime();

test('takes the last hours, the current one last', () => {
  expect(lastHours(now, 3)).toEqual([
    '2026-11-10T10:00:00.000Z',
    '2026-11-10T11:00:00.000Z',
    '2026-11-10T12:00:00.000Z',
  ]);
});

test('puts the reads of each marketplace in their hour, and nothing in an hour with none', () => {
  const rows = readRows(
    [
      { hour: '2026-11-10T11:00:00.000Z', marketplace: 'ozon', reads: 3 },
      { hour: '2026-11-10T11:00:00.000Z', marketplace: 'dns', reads: 1 },
      // Older than the day the chart shows.
      { hour: '2026-11-09T10:00:00.000Z', marketplace: 'ozon', reads: 9 },
    ],
    now,
  );

  expect(rows).toHaveLength(24);
  expect(rows.at(-2)).toEqual({
    hour: '2026-11-10T11:00:00.000Z',
    counts: { ozon: 3, dns: 1 },
    total: 4,
  });
  expect(rows.at(-1)).toEqual({ hour: '2026-11-10T12:00:00.000Z', counts: {}, total: 0 });
  expect(rows.reduce((sum, row): number => sum + row.total, 0)).toBe(4);
});

test('puts the price jobs in the hour they ended', () => {
  const rows = jobRows([{ hour: '2026-11-10T12:00:00.000Z', completed: 5, failed: 2 }], now);

  expect(rows.at(-1)).toEqual({ hour: '2026-11-10T12:00:00.000Z', completed: 5, failed: 2 });
  expect(rows.at(0)).toEqual({ hour: '2026-11-09T13:00:00.000Z', completed: 0, failed: 0 });
});
