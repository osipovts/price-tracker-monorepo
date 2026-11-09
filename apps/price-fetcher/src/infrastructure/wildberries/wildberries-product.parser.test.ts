import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProductReferenceEntity, WildberriesReferenceParser } from 'product-reference';

import type { WildberriesPageInterface } from './wildberries-page.interface.js';
import { WildberriesProductParser } from './wildberries-product.parser.js';

const reference = new ProductReferenceEntity(
  'wildberries',
  '169684889',
  'https://www.wildberries.ru/catalog/169684889/detail.aspx',
);
const parser = new WildberriesProductParser(new WildberriesReferenceParser());

function cardOf(products: unknown[]): string {
  return JSON.stringify({ products });
}

const product = {
  id: 169684889,
  name: 'Кроссовки беговые',
  brand: 'Demix',
  sizes: [
    { name: '42', price: { basic: 599900, product: 349900 }, stocks: [{ wh: 507, qty: 3 }] },
    { name: '43', price: { basic: 599900, product: 329900 }, stocks: [{ wh: 507, qty: 1 }] },
    { name: '44', price: { basic: 599900, product: 299900 }, stocks: [] },
  ],
  totalQuantity: 4,
};
const base: WildberriesPageInterface = {
  url: 'https://www.wildberries.ru/catalog/169684889/detail.aspx',
  imageUrls: [
    'https://basket-12.wbbasket.ru/vol1696/part169684/169684888/images/tm/1.webp',
    'https://basket-12.wbbasket.ru/vol1696/part169684/169684889/images/big/1.webp?picsUpdate=0',
    'https://basket-12.wbbasket.ru/vol1696/part169684/169684889/images/big/2.webp?picsUpdate=0',
  ],
  card: cardOf([{ id: 1, name: 'Другой товар', sizes: [] }, product]),
};

void test('reads the title and the lowest price of the sizes in stock, in kopecks', (): void => {
  const snapshot = parser.parse(reference, base);

  assert.ok(snapshot);
  assert.equal(snapshot.title, 'Кроссовки беговые');
  assert.deepEqual(snapshot.prices, [{ amountMinor: 329900, currency: 'RUB' }]);
  assert.equal(snapshot.availability, 'in_stock');
});

void test('takes the thumbnail of the first picture of the product, not of other products', (): void => {
  assert.equal(
    parser.parse(reference, base)?.imageUrl,
    'https://basket-12.wbbasket.ru/vol1696/part169684/169684889/images/c246x328/1.webp?picsUpdate=0',
  );
  assert.equal(
    parser.parse(reference, {
      ...base,
      imageUrls: [
        'https://basket-12.wbbasket.ru/vol1696/part169684/169684888/images/big/1.webp',
        'https://example.test/vol1696/part169684/169684889/images/big/1.webp',
        'not a link',
      ],
    })?.imageUrl,
    null,
  );
});

void test('reads the answer of an older card service, wrapped in data', (): void => {
  const snapshot = parser.parse(reference, {
    ...base,
    card: JSON.stringify({ data: { products: [product] } }),
  });

  assert.deepEqual(snapshot?.prices, [{ amountMinor: 329900, currency: 'RUB' }]);
});

void test('a product that is out of stock has no price and is read as such', (): void => {
  const snapshot = parser.parse(reference, {
    ...base,
    card: cardOf([{ ...product, sizes: [{ name: '42', stocks: [] }], totalQuantity: 0 }]),
  });

  assert.ok(snapshot);
  assert.equal(snapshot.availability, 'out_of_stock');
  assert.deepEqual(snapshot.prices, []);
});

void test('without the quantity the stocks of the sizes tell the availability', (): void => {
  const { totalQuantity: _, ...withoutQuantity } = product;
  const outOfStock = {
    ...withoutQuantity,
    sizes: [{ name: '42', price: { product: 349900 }, stocks: [] }],
  };

  assert.equal(
    parser.parse(reference, { ...base, card: cardOf([withoutQuantity]) })?.availability,
    'in_stock',
  );
  const snapshot = parser.parse(reference, { ...base, card: cardOf([outOfStock]) });
  assert.equal(snapshot?.availability, 'out_of_stock');
  assert.deepEqual(snapshot.prices, [{ amountMinor: 349900, currency: 'RUB' }]);
  assert.equal(
    parser.parse(reference, {
      ...base,
      card: cardOf([{ ...withoutQuantity, sizes: [{ price: { product: 349900 } }] }]),
    })?.availability,
    'unknown',
  );
});

void test('is null for another page, a card without the product, or no answer of the card service', (): void => {
  assert.equal(
    parser.parse(reference, {
      ...base,
      url: 'https://www.wildberries.ru/catalog/1/detail.aspx',
    }),
    null,
  );
  assert.equal(parser.parse(reference, { ...base, card: cardOf([{ ...product, id: 1 }]) }), null);
  assert.equal(parser.parse(reference, { ...base, card: '' }), null);
  assert.equal(parser.parse(reference, { ...base, card: '{"products":"none"}' }), null);
});

void test('reads another product the card service told the page of, without the pictures of the page', (): void => {
  const other = new ProductReferenceEntity(
    'wildberries',
    '1',
    'https://www.wildberries.ru/catalog/1/detail.aspx',
  );
  const card = cardOf([{ ...product, id: 1, name: 'Другой товар' }, product]);

  const snapshot = parser.parse(other, { ...base, card }, reference);

  assert.equal(snapshot?.title, 'Другой товар');
  assert.deepEqual(snapshot.prices, [{ amountMinor: 329900, currency: 'RUB' }]);
  assert.equal(snapshot.imageUrl, null);
  assert.equal(parser.parse(other, { ...base, card }), null);
});
