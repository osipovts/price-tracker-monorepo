import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProductReferenceEntity, SportmasterReferenceParser } from 'product-reference';

import type { SportmasterPageInterface } from './sportmaster-page.interface.js';
import { SportmasterProductParser } from './sportmaster-product.parser.js';

const reference = new ProductReferenceEntity(
  'sportmaster',
  '33427090299',
  'https://www.sportmaster.ru/product/33427090299/',
);
const parser = new SportmasterProductParser(new SportmasterReferenceParser());
const picture =
  'https://cdn.sportmaster.ru/upload/mdm/media_content/resize/9f5/1200_630_82c6/139852800299.jpg';
const product = {
  '@type': 'Product',
  name: 'Беспроводные наушники Lenovo LP80 Pro Live Pods TWS белые',
  image: [picture],
  offers: {
    '@type': 'Offer',
    price: 2287,
    priceCurrency: 'RUB',
    availability: 'https://schema.org/InStock',
  },
};

function pageOf(value: unknown, url = reference.url): SportmasterPageInterface {
  return { url, cityId: null, structuredData: [JSON.stringify([value])], hasChallenge: false };
}

void test('reads the current price in kopecks, availability and the first picture', (): void => {
  const snapshot = parser.parse(reference, pageOf(product));

  assert.ok(snapshot);
  assert.equal(snapshot.title, product.name);
  assert.deepEqual(snapshot.prices, [{ amountMinor: 228_700, currency: 'RUB' }]);
  assert.equal(snapshot.availability, 'in_stock');
  assert.equal(snapshot.imageUrl, picture);
  assert.ok(!Number.isNaN(Date.parse(snapshot.observedAt)));
});

void test('keeps the last price of a product out of stock and accepts a string amount', (): void => {
  const snapshot = parser.parse(
    reference,
    pageOf({
      ...product,
      image: undefined,
      offers: {
        ...product.offers,
        price: '3987.90',
        availability: 'https://schema.org/OutOfStock',
      },
    }),
  );

  assert.ok(snapshot);
  assert.deepEqual(snapshot.prices, [{ amountMinor: 398_790, currency: 'RUB' }]);
  assert.equal(snapshot.availability, 'out_of_stock');
  assert.equal(snapshot.imageUrl, null);
});

void test('reads a card without an offer but does not choose between multiple sellers', (): void => {
  const withoutOffer = parser.parse(reference, pageOf({ ...product, offers: undefined }));
  assert.ok(withoutOffer);
  assert.deepEqual(withoutOffer.prices, []);
  assert.equal(withoutOffer.availability, 'unknown');

  const multiple = parser.parse(
    reference,
    pageOf({ ...product, offers: [product.offers, { ...product.offers, price: 2000 }] }),
  );
  assert.ok(multiple);
  assert.deepEqual(multiple.prices, []);
  assert.equal(multiple.availability, 'unknown');
});

void test('rejects another product URL and invalid or non-ruble JSON-LD', (): void => {
  assert.equal(
    parser.parse(reference, pageOf(product, 'https://www.sportmaster.ru/product/33426920299/')),
    null,
  );
  assert.equal(
    parser.parse(reference, pageOf({ '@type': 'Organization', name: 'Спортмастер' })),
    null,
  );
  assert.equal(
    parser.parse(reference, {
      url: reference.url,
      cityId: null,
      structuredData: ['not json'],
      hasChallenge: false,
    }),
    null,
  );
  assert.equal(
    parser.parse(
      reference,
      pageOf({ ...product, offers: { ...product.offers, priceCurrency: 'USD' } }),
    ),
    null,
  );
});
