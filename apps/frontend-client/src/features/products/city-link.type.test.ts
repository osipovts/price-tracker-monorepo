import { expect, test } from 'vitest';

import { cityMarketplaceOf } from './city-link.type.js';

test('tells the marketplace of a link whose prices depend on the city', (): void => {
  expect(cityMarketplaceOf('https://www.dns-shop.ru/product/0463bb2411a1d582/156-noutbuk/')).toBe(
    'dns',
  );
  expect(cityMarketplaceOf('https://dns-shop.ru/product/0463bb2411a1d582/')).toBe('dns');
  expect(cityMarketplaceOf('https://www.wildberries.ru/catalog/169684889/detail.aspx')).toBe(
    'wildberries',
  );
  expect(cityMarketplaceOf('https://wb.ru/catalog/169684889/detail.aspx')).toBe('wildberries');
});

test('has no city for the other links, for a link that is not finished, or for a lookalike host', (): void => {
  expect(cityMarketplaceOf('https://www.ozon.ru/product/1/')).toBeNull();
  expect(cityMarketplaceOf('https://www.dns-shop.ru.evil.test/product/1/')).toBeNull();
  expect(cityMarketplaceOf('https://www.dns-sh')).toBeNull();
  expect(cityMarketplaceOf('')).toBeNull();
});
