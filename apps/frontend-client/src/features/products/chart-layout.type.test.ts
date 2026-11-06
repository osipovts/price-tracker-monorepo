import { expect, test } from 'vitest';

import { chartPointsFitting, chartPointsMax } from './chart-layout.type.js';

test('fits the same number of points into a wide chart, however wide it is', () => {
  expect(chartPointsFitting(900)).toBe(chartPointsMax);
  expect(chartPointsFitting(1600)).toBe(chartPointsMax);
});

test('fits fewer points into a narrow chart, each at least 10 pixels from the next', () => {
  // A phone: 300 pixels, 72 of them for the prices, 16 kept at the right.
  expect(chartPointsFitting(300)).toBe(21);
});

test('fits nothing into a chart not laid out yet', () => {
  expect(chartPointsFitting(0)).toBe(0);
});
