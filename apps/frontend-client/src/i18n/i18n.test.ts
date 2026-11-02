import { afterEach, expect, test, vi } from 'vitest';

import { chooseLanguage, createI18n } from './i18n.js';

function browserAsks(...languages: string[]): void {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0] ?? 'en');
}

afterEach((): void => {
  localStorage.clear();
  createI18n('en');
});

test('takes the language the browser asks for first, and its regional variants', () => {
  browserAsks('ru-RU', 'en-US');

  const i18n = createI18n();

  expect(i18n.resolvedLanguage).toBe('ru');
  expect(i18n.t('brand.slogan')).toBe('трекер цен: ozon, wb, dns, и др.');
  expect(document.documentElement.lang).toBe('ru');
});

test('skips the languages it has no words in, and falls back to English', () => {
  browserAsks('de-DE', 'ru');
  expect(createI18n().resolvedLanguage).toBe('ru');

  browserAsks('de-DE', 'fr');
  const i18n = createI18n();
  expect(i18n.resolvedLanguage).toBe('en');
  expect(i18n.t('brand.slogan')).toBe('price tracker: ozon, wb, dns, etc.');
});

test('keeps the language the person picked over the one of the browser', async () => {
  browserAsks('ru-RU');
  const first = createI18n();
  await chooseLanguage(first, 'en');

  const second = createI18n();

  expect(second.resolvedLanguage).toBe('en');
});

test('fills in the values of a phrase', () => {
  const i18n = createI18n('ru');

  expect(i18n.t('chart.lastKnown', { price: '1 299,00 ₽' })).toBe(
    'Последняя известная: 1 299,00 ₽',
  );
});
