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
  expect(cityMarketplaceOf('https://www.citilink.ru/product/noutbuk-2194059/')).toBe('citilink');
  expect(cityMarketplaceOf('https://citilink.ru/product/2194059/')).toBe('citilink');
  expect(cityMarketplaceOf('https://www.ozon.ru/product/1/')).toBe('ozon');
  expect(cityMarketplaceOf('https://ozon.ru/t/AbC')).toBe('ozon');
  expect(cityMarketplaceOf('https://www.sportmaster.ru/product/33427090299/')).toBe('sportmaster');
  expect(cityMarketplaceOf('https://sportmaster.ru/product/33427090299/')).toBe('sportmaster');
  expect(cityMarketplaceOf('https://aliexpress.ru/item/1005012815784218.html')).toBe('aliexpress');
  expect(cityMarketplaceOf('https://www.aliexpress.ru/item/1005012815784218.html')).toBe(
    'aliexpress',
  );
  expect(
    cityMarketplaceOf(
      'https://apteka.ru/product/jodomarin-200-50-sht-tabletki-5e32674d65b5ab0001650ab2/',
    ),
  ).toBe('apteka');
  expect(
    cityMarketplaceOf(
      'https://apteka.ru/irkutsk/product/jodomarin-200-50-sht-tabletki-5e32674d65b5ab0001650ab2/',
    ),
  ).toBe('apteka');
  expect(cityMarketplaceOf('https://www.apteka.ru/product/5e32674d65b5ab0001650ab2/')).toBe(
    'apteka',
  );
});

test('has no city for a link of another site, for a link that is not finished, or for a lookalike host', (): void => {
  expect(cityMarketplaceOf('https://example.com/product/1/')).toBeNull();
  expect(cityMarketplaceOf('https://www.dns-shop.ru.evil.test/product/1/')).toBeNull();
  expect(cityMarketplaceOf('https://www.dns-sh')).toBeNull();
  expect(cityMarketplaceOf('')).toBeNull();
});
