import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { toRows } from './chart-rows.type.js';
import type { GranularityType, PriceBucketInterface } from './price-series.type.js';
import { PriceTooltip } from './price-tooltip.component.js';

const series = [
  { id: 'a', label: 'ozon', color: 'blue' },
  { id: 'b', label: 'dns', color: 'orange' },
];

function bucket(overrides: Partial<PriceBucketInterface>): PriceBucketInterface {
  return {
    start: new Date(2026, 10, 1, 14),
    value: null,
    observed: false,
    ...overrides,
  };
}

function show(
  a: PriceBucketInterface,
  b: PriceBucketInterface,
  granularity: GranularityType = 'hour',
): void {
  const [row] = toRows([
    { id: 'a', buckets: [a] },
    { id: 'b', buckets: [b] },
  ]);
  if (row === undefined) throw new Error('no row');

  render(
    <MantineProvider>
      <PriceTooltip row={row} granularity={granularity} series={series} />
    </MantineProvider>,
  );
}

test('tells the price of each product at the point: the one read, or the last known when none was', () => {
  show(bucket({ value: 130000, observed: true }), bucket({ value: 99000, observed: false }));

  expect(screen.getByText(/^ozon: 1\s300\s₽$/)).toBeInTheDocument();
  expect(screen.getByText(/^dns: Last known: 990\s₽$/)).toBeInTheDocument();
  // The point of an hour is its end.
  expect(screen.getByText(/15:00|3:00/)).toBeInTheDocument();
});

test('calls the point of a week the week up to its Sunday', () => {
  show(
    { start: new Date(2026, 9, 26), value: 100, observed: true },
    { start: new Date(2026, 9, 26), value: null, observed: false },
    'week',
  );

  expect(screen.getByText(/^The week to November 1, 2026$/)).toBeInTheDocument();
});

test('says there was no price yet before the first one', () => {
  show(bucket({}), bucket({}));

  expect(screen.getAllByText(/no price yet/i)).toHaveLength(2);
});
