import { expect, test } from 'vitest';

import { marketplaceColor, marketplaceName } from './marketplace-name.component.js';

test('ozon is blue, dns is orange, wildberries is grape, and a marketplace not known yet is grey', () => {
  expect(marketplaceColor('ozon')).toBe('blue');
  expect(marketplaceColor('dns')).toBe('orange');
  expect(marketplaceColor('wildberries')).toBe('grape');
  expect(marketplaceColor('yandex')).toBe('gray');
});

test('wildberries is shown as wb, and the others by their own name', () => {
  expect(marketplaceName('wildberries')).toBe('wb');
  expect(marketplaceName('ozon')).toBe('ozon');
  expect(marketplaceName('yandex')).toBe('yandex');
});
