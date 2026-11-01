import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import { toRows } from './chart-rows.type.js';
import type { PriceBucketInterface } from './price-series.type.js';
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
    min: null,
    max: null,
    last: null,
    average: null,
    ...overrides,
  };
}

function show(a: PriceBucketInterface, b: PriceBucketInterface): void {
  const [row] = toRows([
    { id: 'a', buckets: [a] },
    { id: 'b', buckets: [b] },
  ]);
  if (row === undefined) throw new Error('no row');

  render(
    <MantineProvider>
      <PriceTooltip row={row} granularity="hour" series={series} />
    </MantineProvider>,
  );
}

test('tells the average, the lowest and the highest price of an hour with prices, by product', () => {
  show(
    bucket({
      value: 130000,
      observed: true,
      average: 130000,
      min: 120000,
      max: 140000,
      last: 125000,
    }),
    bucket({ value: 99000, observed: false }),
  );

  expect(screen.getByText(/ozon:.*average.*min.*max/i)).toBeInTheDocument();
  expect(screen.getByText(/dns:.*last known/i)).toBeInTheDocument();
});

test('says there was no price yet before the first one', () => {
  show(bucket({}), bucket({}));

  expect(screen.getAllByText(/no price yet/i)).toHaveLength(2);
});
