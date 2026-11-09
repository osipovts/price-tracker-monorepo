import { expect, test } from 'vitest';

import { createI18n } from '../i18n/i18n.js';
import { durationOf, formatDuration, formatPrice } from './format.type.js';

const { t } = createI18n('en');

test('tells a duration in seconds, in minutes and seconds, and in hours and minutes', () => {
  expect(formatDuration(4_400, t)).toBe('4 s');
  expect(formatDuration(125_000, t)).toBe('2 min 5 s');
  expect(formatDuration(3 * 3_600_000 + 7 * 60_000, t)).toBe('3 h 7 min');
});

test('counts a duration to now while there is no end, and has none with no start', () => {
  const now = new Date('2026-11-10T12:00:10Z').getTime();

  expect(durationOf('2026-11-10T12:00:00Z', null, now)).toBe(10_000);
  expect(durationOf('2026-11-10T12:00:00Z', '2026-11-10T12:00:03Z', now)).toBe(3_000);
  expect(durationOf(null, null, now)).toBeNull();
});

test('shows a price in kopecks to the rouble', () => {
  expect(formatPrice(123_456, 'en')).toMatch(/^RUB\s1,235$/);
});
