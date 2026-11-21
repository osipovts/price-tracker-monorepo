import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AptekaReferenceParser, ProductReferenceEntity } from 'product-reference';

import type { AptekaPageInterface } from './apteka-page.interface.js';
import { AptekaProductParser } from './apteka-product.parser.js';

const parser = new AptekaProductParser(new AptekaReferenceParser());
const reference = new ProductReferenceEntity(
  'apteka',
  '5e32674d65b5ab0001650ab2',
  'https://apteka.ru/product/5e32674d65b5ab0001650ab2/',
);

function pageOf(
  state: unknown,
  url = 'https://apteka.ru/irkutsk/product/jodomarin-5e32674d65b5ab0001650ab2/',
): AptekaPageInterface {
  return {
    url,
    cityId: 'irkutsk',
    initialState: typeof state === 'string' ? state : JSON.stringify(state),
    hasChallenge: false,
  };
}

void test('reads fractional ruble price, availability and mediaWithUids image for the requested variant', (): void => {
  const snapshot = parser.parse(
    reference,
    pageOf({
      product: {
        groupItems: [
          {
            itemInfos: [
              {
                id: '5e32673cf5a9ae0001407b6d',
                name: 'Йодомарин 200 100 шт. таблетки',
                price: 228,
                outOfStock: false,
              },
              {
                id: '5e32674d65b5ab0001650ab2',
                name: 'Йодомарин 200 50 шт. таблетки',
                price: 144.1,
                outOfStock: false,
                mediaWithUids: [{ photoUrl: '3c1bcf4a-d96f-49d9-9831-d2cf19238f5f.webp' }],
                photoPack: {
                  photos: [{ original: 'https://images.apteka.ru/original_fallback.jpeg' }],
                },
              },
            ],
          },
        ],
      },
    }),
  );

  assert.equal(snapshot?.title, 'Йодомарин 200 50 шт. таблетки');
  assert.deepEqual(snapshot.prices, [{ amountMinor: 14_410, currency: 'RUB' }]);
  assert.equal(snapshot.availability, 'in_stock');
  assert.equal(
    snapshot.imageUrl,
    'https://images.apteka.ru/original_3c1bcf4a-d96f-49d9-9831-d2cf19238f5f.webp',
  );
});

void test('falls back to typedPrices and photoPack when price is 0 in stock and mediaWithUids is empty', (): void => {
  const snapshot = parser.parse(
    reference,
    pageOf({
      product: {
        groupItems: [
          {
            itemInfos: [
              {
                id: '5e32674d65b5ab0001650ab2',
                name: 'Йодомарин 200 50 шт. таблетки',
                price: 0,
                outOfStock: false,
                typedPrices: [{ dbPrice: 163.99 }, { dbPrice: 190 }],
                mediaWithUids: [],
                photoPack: {
                  photos: [{ original: 'https://images.apteka.ru/original_pack.jpeg' }],
                },
              },
            ],
          },
        ],
      },
    }),
  );

  assert.deepEqual(snapshot?.prices, [{ amountMinor: 16_399, currency: 'RUB' }]);
  assert.equal(snapshot.availability, 'in_stock');
  assert.equal(snapshot.imageUrl, 'https://images.apteka.ru/original_pack.jpeg');
});

void test('reports out of stock with empty prices instead of stale lastPrice', (): void => {
  const snapshot = parser.parse(
    reference,
    pageOf({
      product: {
        groupItems: [
          {
            itemInfos: [
              {
                id: '5e32674d65b5ab0001650ab2',
                name: 'Йодомарин 200 50 шт. таблетки',
                price: 0,
                lastPrice: 228,
                outOfStock: true,
              },
            ],
          },
        ],
      },
    }),
  );

  assert.deepEqual(snapshot?.prices, []);
  assert.equal(snapshot.availability, 'out_of_stock');
  assert.equal(snapshot.imageUrl, null);
});

void test('returns null on foreign URLs, mismatched ids, product errors or malformed state', (): void => {
  const validItem = {
    product: {
      groupItems: [{ itemInfos: [{ id: '5e32674d65b5ab0001650ab2', name: 'Test', price: 100 }] }],
    },
  };

  assert.equal(
    parser.parse(
      reference,
      pageOf(validItem, 'https://apteka.ru/product/000000000000000000000000/'),
    ),
    null,
  );
  assert.equal(
    parser.parse(
      reference,
      pageOf({
        product: {
          groupItems: [
            { itemInfos: [{ id: '000000000000000000000000', name: 'Other', price: 100 }] },
          ],
        },
      }),
    ),
    null,
  );
  assert.equal(parser.parse(reference, pageOf({ product: { error: true, groupItems: [] } })), null);
  assert.equal(parser.parse(reference, pageOf('{not json')), null);
});
