import { expect, test } from 'vitest';

import { styleSeries } from './series-style.type.js';

test('a line has the colour of its marketplace, and is named after it and the city', () => {
  const styles = styleSeries([
    { id: 'a', marketplace: 'ozon', cityName: null },
    { id: 'b', marketplace: 'dns', cityName: 'Иркутск' },
    { id: 'c', marketplace: 'wildberries', cityName: null },
  ]);

  expect(styles).toEqual([
    { id: 'a', label: 'ozon', color: 'blue' },
    { id: 'b', label: 'dns, Иркутск', color: 'orange' },
    { id: 'c', label: 'wb', color: 'grape' },
  ]);
});

test('a second product of a marketplace gets a colour of its own, and a number when it has no city to be told by', () => {
  const styles = styleSeries([
    { id: 'a', marketplace: 'ozon', cityName: null },
    { id: 'b', marketplace: 'ozon', cityName: null },
  ]);

  expect(styles.map(({ label }) => label)).toEqual(['ozon #1', 'ozon #2']);
  expect(new Set(styles.map(({ color }) => color)).size).toBe(2);
});
