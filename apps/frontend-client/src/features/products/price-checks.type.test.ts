import { expect, test } from 'vitest';

import { createI18n } from '../../i18n/i18n.js';
import { describePriceChecks } from './price-checks.type.js';

const now = new Date(2026, 10, 3, 15, 30);
const at = (day: number, hour: number, minute: number): string =>
  new Date(2026, 10, day, hour, minute).toISOString();

test('tells the last read by the day and the time, and the next one by the time alone', () => {
  const { t } = createI18n('ru');

  expect(
    describePriceChecks(
      { checkedAt: at(2, 23, 5), marketplace: null, nextAt: at(4, 1, 40) },
      t,
      'ru',
      now,
    ),
  ).toEqual({ checked: 'вчера в 23:05', next: '01:40' });
});

test('names the marketplace of the last read when it is given', () => {
  const { t } = createI18n('ru');

  expect(
    describePriceChecks(
      { checkedAt: at(1, 9, 0), marketplace: 'ozon', nextAt: null },
      t,
      'ru',
      now,
    ),
  ).toEqual({ checked: '01.11.2026 в 09:00, ozon', next: null });
});

test('says soon of a next read whose time has passed', () => {
  const { t } = createI18n('en');

  const { checked, next } = describePriceChecks(
    { checkedAt: at(3, 9, 0), marketplace: null, nextAt: at(3, 10, 0) },
    t,
    'en',
    now,
  );

  expect(checked).toMatch(/^today at /);
  expect(next).toBe('soon');
});

test('leaves out what is not known', () => {
  const { t } = createI18n('ru');

  expect(
    describePriceChecks({ checkedAt: null, marketplace: null, nextAt: at(3, 16, 0) }, t, 'ru', now),
  ).toEqual({ checked: null, next: '16:00' });
  expect(
    describePriceChecks({ checkedAt: null, marketplace: null, nextAt: null }, t, 'ru', now),
  ).toEqual({ checked: null, next: null });
});
