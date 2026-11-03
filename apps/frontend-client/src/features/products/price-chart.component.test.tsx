import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { PriceChart } from './price-chart.component.js';
import type { PriceBucketInterface } from './price-series.type.js';

function bucket(hour: number, value: number | null, observed: boolean): PriceBucketInterface {
  return { start: new Date(2026, 10, 1, hour), value, observed };
}

// jsdom lays nothing out: the container of the chart is given the size a browser would give it.
beforeEach((): void => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 600, 560),
  );
});

test('names the line of each product under the chart', () => {
  render(
    <MantineProvider>
      <PriceChart
        granularity="hour"
        lines={[
          {
            id: 'a',
            label: 'ozon',
            color: 'blue',
            buckets: [
              bucket(10, 100_000_00, true),
              bucket(11, 100_000_00, false),
              bucket(12, 110_000_00, true),
            ],
          },
          {
            id: 'b',
            label: 'dns, Иркутск',
            color: 'orange',
            buckets: [
              bucket(10, 120_000_00, true),
              bucket(11, 120_000_00, true),
              bucket(12, 120_000_00, true),
            ],
          },
        ]}
      />
    </MantineProvider>,
  );

  expect(screen.getByText('ozon')).toBeInTheDocument();
  expect(screen.getByText('dns, Иркутск')).toBeInTheDocument();
  // The lines themselves need a browser to be laid out: the end-to-end test of the client checks them.
});
