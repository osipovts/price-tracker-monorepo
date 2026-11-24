import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CifrusReferenceParser, ProductReferenceEntity } from 'product-reference';

import type { CifrusPageInterface } from './cifrus-page.interface.js';
import { CifrusProductParser } from './cifrus-product.parser.js';

const parser = new CifrusProductParser(new CifrusReferenceParser());
const reference = new ProductReferenceEntity(
  'cifrus',
  '1/apple_iphone_17_256gb_white_a3520',
  'https://www.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520',
);

function pageOf(overrides: Partial<CifrusPageInterface> = {}): CifrusPageInterface {
  return {
    url: 'https://www.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520',
    cityId: '74507',
    heading: 'Apple iPhone 17 256Gb White (Белый) (A3520)',
    offerPrice: '77710',
    offerCurrency: 'RUB',
    offerAvailability: 'https://schema.org/InStock',
    displayedPriceText: '77710 руб.',
    hasOutOfStockBadge: false,
    hasBuyButton: true,
    imageUrl:
      'https://www.cifrus.ru/photos/little/apple/apple-iphone-17-256gb-white-a3258-ll-1.jpg',
    hasChallenge: false,
    ...overrides,
  };
}

void test('parses an in-stock Cifrus product card into kopecks with HTTPS image', (): void => {
  const snapshot = parser.parse(reference, pageOf({ offerPrice: '77710.50' }));

  assert.equal(snapshot?.title, 'Apple iPhone 17 256Gb White (Белый) (A3520)');
  assert.deepEqual(snapshot.prices, [{ amountMinor: 7_771_050, currency: 'RUB' }]);
  assert.equal(snapshot.availability, 'in_stock');
  assert.equal(
    snapshot.imageUrl,
    'https://www.cifrus.ru/photos/little/apple/apple-iphone-17-256gb-white-a3258-ll-1.jpg',
  );
});

void test('drops stale meta offer price when the product is out of stock', (): void => {
  const snapshot = parser.parse(
    reference,
    pageOf({
      offerPrice: '32390',
      offerAvailability: 'https://schema.org/OutOfStock',
      displayedPriceText: '',
      hasOutOfStockBadge: true,
      hasBuyButton: false,
    }),
  );

  assert.equal(snapshot?.availability, 'out_of_stock');
  assert.deepEqual(snapshot.prices, []);
});

void test('falls back to displayed price when offer microdata is missing or non-RUB', (): void => {
  const withoutOffer = parser.parse(
    reference,
    pageOf({
      offerPrice: '',
      offerCurrency: '',
      offerAvailability: '',
      displayedPriceText: '83 150 руб.',
      hasBuyButton: true,
    }),
  );
  assert.equal(withoutOffer?.availability, 'in_stock');
  assert.deepEqual(withoutOffer.prices, [{ amountMinor: 8_315_000, currency: 'RUB' }]);

  const nonRubOffer = parser.parse(
    reference,
    pageOf({
      offerPrice: '900',
      offerCurrency: 'USD',
      offerAvailability: '',
      displayedPriceText: '',
      hasBuyButton: false,
    }),
  );
  assert.equal(nonRubOffer?.availability, 'unknown');
  assert.deepEqual(nonRubOffer.prices, []);
});

void test('returns null for another product, empty heading, and drops non-HTTPS images', (): void => {
  assert.equal(
    parser.parse(reference, pageOf({ url: 'https://www.cifrus.ru/description/1/other' })),
    null,
  );
  assert.equal(parser.parse(reference, pageOf({ heading: '' })), null);

  const snapshot = parser.parse(
    reference,
    pageOf({ imageUrl: 'http://www.cifrus.ru/photos/1.jpg' }),
  );
  assert.equal(snapshot?.imageUrl, null);
});
