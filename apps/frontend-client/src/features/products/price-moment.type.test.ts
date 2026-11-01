import { expect, test } from 'vitest';

import { formatPriceMoment } from './price-moment.type.js';

const now = new Date(2026, 10, 2, 15, 30);

test('says today and yesterday in the language of the user, with the time', () => {
  const today = new Date(2026, 10, 2, 9, 5).toISOString();
  const yesterday = new Date(2026, 10, 1, 23, 59).toISOString();

  expect(formatPriceMoment(today, 'ru', now)).toBe('сегодня, 09:05');
  expect(formatPriceMoment(yesterday, 'ru', now)).toBe('вчера, 23:59');
  expect(formatPriceMoment(today, 'en', now)).toMatch(/^today, /);
  expect(formatPriceMoment(yesterday, 'en', now)).toMatch(/^yesterday, /);
});

test('writes any other day as dd.mm.yyyy whatever the language', () => {
  const older = new Date(2026, 9, 5, 7, 8).toISOString();

  expect(formatPriceMoment(older, 'ru', now)).toBe('05.10.2026, 07:08');
  expect(formatPriceMoment(older, 'en', now)).toMatch(/^05\.10\.2026, /);
});

test('the day changes at midnight of the browser, not 24 hours after the price', () => {
  const justAfterMidnight = new Date(2026, 10, 2, 0, 1);
  const lateYesterday = new Date(2026, 10, 1, 23, 58).toISOString();

  expect(formatPriceMoment(lateYesterday, 'ru', justAfterMidnight)).toMatch(/^вчера/);
});
