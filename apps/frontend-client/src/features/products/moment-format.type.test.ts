import { expect, test } from 'vitest';

import { createI18n } from '../../i18n/i18n.js';
import { formatDayMoment } from './moment-format.type.js';

const now = new Date(2026, 10, 2, 15, 30);

test('says today and yesterday in the language of the user, at the time', () => {
  const today = new Date(2026, 10, 2, 9, 5).toISOString();
  const yesterday = new Date(2026, 10, 1, 23, 59).toISOString();
  const ru = createI18n('ru').t;
  const en = createI18n('en').t;

  expect(formatDayMoment(today, ru, 'ru', now)).toBe('сегодня в 09:05');
  expect(formatDayMoment(yesterday, ru, 'ru', now)).toBe('вчера в 23:59');
  expect(formatDayMoment(today, en, 'en', now)).toMatch(/^today at /);
  expect(formatDayMoment(yesterday, en, 'en', now)).toMatch(/^yesterday at /);
});

test('writes any other day as dd.mm.yyyy whatever the language', () => {
  const older = new Date(2026, 9, 5, 7, 8).toISOString();

  expect(formatDayMoment(older, createI18n('ru').t, 'ru', now)).toBe('05.10.2026 в 07:08');
  expect(formatDayMoment(older, createI18n('en').t, 'en', now)).toMatch(/^05\.10\.2026 at /);
});

test('the day changes at midnight of the browser, not 24 hours after the price', () => {
  const justAfterMidnight = new Date(2026, 10, 2, 0, 1);
  const lateYesterday = new Date(2026, 10, 1, 23, 58).toISOString();

  expect(formatDayMoment(lateYesterday, createI18n('ru').t, 'ru', justAfterMidnight)).toMatch(
    /^вчера/,
  );
});

test('writes tomorrow as its date: only today and yesterday have words', () => {
  const tomorrow = new Date(2026, 10, 3, 1, 15).toISOString();

  expect(formatDayMoment(tomorrow, createI18n('ru').t, 'ru', now)).toBe('03.11.2026 в 01:15');
});
