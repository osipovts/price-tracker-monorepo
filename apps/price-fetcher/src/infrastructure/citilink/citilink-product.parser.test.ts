import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CitilinkReferenceParser, ProductReferenceEntity } from 'product-reference';

import type { CitilinkPageInterface } from './citilink-page.interface.js';
import { CitilinkProductParser } from './citilink-product.parser.js';
import { CitilinkStateParser } from './citilink-state.parser.js';

const reference = new ProductReferenceEntity(
  'citilink',
  '2194059',
  'https://www.citilink.ru/product/2194059/',
);
const parser = new CitilinkProductParser(new CitilinkReferenceParser(), new CitilinkStateParser());

const picture = (width: number): string =>
  `https://cdn.citilink.ru/key/resizing_type:fit/gravity:sm/width:${String(width)}/height:${String(width)}/plain/product-images/c19056fe.jpg`;
const productBase = {
  id: '2194059',
  name: 'Ноутбук ASUS Zenbook A16 UX3607OA-SQ013W',
  isAvailable: true,
  price: { current: '239990', old: '287990', club: '237990', clubPriceViewType: 'PRICE_IN_RUB' },
  images: [
    {
      sources: [
        { url: picture(55), size: 'SM' },
        { url: picture(250), size: 'MD' },
      ],
    },
  ],
};

function pageOf(
  product: object,
  url = 'https://www.citilink.ru/product/noutbuk-asus-zenbook-ux3607oa-sq013w-2194059/',
): CitilinkPageInterface {
  const initialState = {
    system: { metadata: { 'x-citilink-city-id': 'msk_cl' } },
    productPage: { productHeader: { payload: { productBase: product } } },
  };

  return { url, state: JSON.stringify({ props: { initialState } }) };
}

void test('reads the club price first and the price for everyone after it, in kopecks', (): void => {
  const snapshot = parser.parse(reference, pageOf(productBase));

  assert.ok(snapshot);
  assert.equal(snapshot.title, 'Ноутбук ASUS Zenbook A16 UX3607OA-SQ013W');
  assert.deepEqual(snapshot.prices, [
    { amountMinor: 23_799_000, currency: 'RUB' },
    { amountMinor: 23_999_000, currency: 'RUB' },
  ]);
  assert.equal(snapshot.availability, 'in_stock');
  assert.equal(snapshot.imageUrl, picture(250));
});

void test('a product without a club price, or with one not below the other, has the price for everyone', (): void => {
  for (const club of ['0', null, '239990', '249990']) {
    const snapshot = parser.parse(
      reference,
      pageOf({ ...productBase, price: { current: '239990', club } }),
    );

    assert.deepEqual(
      snapshot?.prices,
      [{ amountMinor: 23_999_000, currency: 'RUB' }],
      String(club),
    );
  }
});

void test('a product out of stock has no price: the site gives zeros for its prices', (): void => {
  const snapshot = parser.parse(
    reference,
    pageOf({
      ...productBase,
      isAvailable: false,
      price: { current: '0', old: '0', club: '0', clubPriceViewType: 'INVALID' },
    }),
  );

  assert.equal(snapshot?.availability, 'out_of_stock');
  assert.deepEqual(snapshot.prices, []);
});

void test('a page of another product, or without a card, is not the card of the product', (): void => {
  assert.equal(
    parser.parse(reference, pageOf(productBase, 'https://www.citilink.ru/product/drugoi-2154262/')),
    null,
  );
  assert.equal(parser.parse(reference, pageOf({ ...productBase, id: '2154262' })), null);
  assert.equal(parser.parse(reference, { url: reference.url, state: '' }), null);
});

void test('a product without pictures has none', (): void => {
  const { images: _images, ...withoutImages } = productBase;

  assert.equal(parser.parse(reference, pageOf(withoutImages))?.imageUrl, null);
});
