import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AliexpressReferenceParser, ProductReferenceEntity } from 'product-reference';

import type { AliexpressPageInterface } from './aliexpress-page.interface.js';
import { AliexpressProductParser } from './aliexpress-product.parser.js';

const reference = new ProductReferenceEntity(
  'aliexpress',
  '1005012815784218',
  'https://aliexpress.ru/item/1005012815784218.html',
);
const parser = new AliexpressProductParser(new AliexpressReferenceParser());
const picture = 'https://ae-pic-a1.aliexpress-media.com/kf/S47ae477f66004551a22e01cad75610e0K.png';

const productDataBase = {
  id: '1005012815784218',
  name: 'Акриловый брелок Nightcrawler Курт Вагнер чиби',
  gallery: [{ imageUrl: picture }],
  activeSkuId: '12000059397901048',
  itemStatus: 0,
  quantity: { totalCount: '3' },
  price: {
    minActivityAmount: { value: 399, currency: 'RUB', cents: '39900' },
    minAmount: { value: 466, currency: 'RUB', cents: '46600' },
  },
  skuInfo: {
    priceList: [
      {
        skuId: '12000059397901048',
        availQuantity: 3,
        activityAmount: { value: 399, currency: 'RUB', cents: '39900' },
        amount: { value: 466, currency: 'RUB', cents: '46600' },
      },
    ],
  },
};

function pageOf(data: unknown, url = reference.url): AliexpressPageInterface {
  return {
    url,
    cityId: '917477679070000000',
    productData: JSON.stringify({ data }),
    hasChallenge: false,
  };
}

void test('reads the current activity price in kopecks, availability and the first picture', (): void => {
  const snapshot = parser.parse(reference, pageOf(productDataBase));

  assert.ok(snapshot);
  assert.equal(snapshot.title, productDataBase.name);
  assert.deepEqual(snapshot.prices, [{ amountMinor: 39_900, currency: 'RUB' }]);
  assert.equal(snapshot.availability, 'in_stock');
  assert.equal(snapshot.imageUrl, picture);
  assert.ok(!Number.isNaN(Date.parse(snapshot.observedAt)));
});

void test('handles out of stock products via itemStatus or zero quantity', (): void => {
  const byStatus = parser.parse(
    reference,
    pageOf({
      ...productDataBase,
      itemStatus: 1,
      quantity: { totalCount: '0' },
      skuInfo: {
        priceList: [
          {
            skuId: '12000059397901048',
            availQuantity: 0,
            amount: { value: 466, currency: 'RUB' },
          },
        ],
      },
    }),
  );

  assert.ok(byStatus);
  assert.equal(byStatus.availability, 'out_of_stock');
  assert.deepEqual(byStatus.prices, [{ amountMinor: 46_600, currency: 'RUB' }]);

  const bySkuQty = parser.parse(
    reference,
    pageOf({
      ...productDataBase,
      itemStatus: 0,
      quantity: undefined,
      skuInfo: {
        priceList: [
          {
            skuId: '12000059397901048',
            availQuantity: 0,
            amount: { value: 466.5, currency: 'RUB' },
          },
        ],
      },
    }),
  );

  assert.ok(bySkuQty);
  assert.equal(bySkuQty.availability, 'out_of_stock');
  assert.deepEqual(bySkuQty.prices, [{ amountMinor: 46_650, currency: 'RUB' }]);
});

void test('returns partial snapshot with empty prices when price is missing', (): void => {
  const withoutPrice = parser.parse(
    reference,
    pageOf({
      id: '1005012815784218',
      name: 'Акриловый брелок',
      gallery: undefined,
      itemStatus: 0,
      quantity: undefined,
      price: undefined,
      skuInfo: { priceList: [] },
    }),
  );

  assert.ok(withoutPrice);
  assert.deepEqual(withoutPrice.prices, []);
  assert.equal(withoutPrice.availability, 'unknown');
  assert.equal(withoutPrice.imageUrl, null);
});

void test('rejects another product URL, mismatched product id, invalid json, or non-ruble currency', (): void => {
  assert.equal(
    parser.parse(reference, pageOf(productDataBase, 'https://aliexpress.ru/item/999999999.html')),
    null,
  );
  assert.equal(parser.parse(reference, pageOf({ ...productDataBase, id: '999999999' })), null);
  assert.equal(
    parser.parse(reference, {
      url: reference.url,
      cityId: null,
      productData: 'not json',
      hasChallenge: false,
    }),
    null,
  );
  const nonRub = parser.parse(
    reference,
    pageOf({
      ...productDataBase,
      price: { minAmount: { value: 10, currency: 'USD' } },
      skuInfo: {
        priceList: [
          {
            skuId: '12000059397901048',
            availQuantity: 3,
            activityAmount: { value: 10, currency: 'USD' },
          },
        ],
      },
    }),
  );
  assert.ok(nonRub);
  assert.deepEqual(nonRub.prices, []);
});

void test('reads price and availability of the requested sku_id instead of activeSkuId', (): void => {
  const skuReference = new ProductReferenceEntity(
    'aliexpress',
    '1005012815784218:12000037931516788',
    'https://aliexpress.ru/item/1005012815784218.html?sku_id=12000037931516788',
  );
  const multiSkuData = {
    ...productDataBase,
    activeSkuId: '12000037931516812',
    quantity: { totalCount: '10' },
    skuInfo: {
      priceList: [
        {
          skuId: '12000037931516812',
          availQuantity: 7,
          activityAmount: { value: 27_000, currency: 'RUB', cents: '2700000' },
        },
        {
          skuId: '12000037931516788',
          availQuantity: 3,
          activityAmount: { value: 13_000, currency: 'RUB', cents: '1300000' },
        },
      ],
    },
  };

  const snapshot = parser.parse(skuReference, pageOf(multiSkuData, skuReference.url));

  assert.ok(snapshot);
  assert.deepEqual(snapshot.prices, [{ amountMinor: 1_300_000, currency: 'RUB' }]);
  assert.equal(snapshot.availability, 'in_stock');

  const outOfStockVariant = parser.parse(
    skuReference,
    pageOf(
      {
        ...multiSkuData,
        skuInfo: {
          priceList: [
            multiSkuData.skuInfo.priceList[0],
            {
              skuId: '12000037931516788',
              availQuantity: 0,
              activityAmount: { value: 13_000, currency: 'RUB', cents: '1300000' },
            },
          ],
        },
      },
      skuReference.url,
    ),
  );

  assert.ok(outOfStockVariant);
  assert.deepEqual(outOfStockVariant.prices, [{ amountMinor: 1_300_000, currency: 'RUB' }]);
  assert.equal(outOfStockVariant.availability, 'out_of_stock');

  const missingVariant = parser.parse(
    skuReference,
    pageOf(
      {
        ...multiSkuData,
        skuInfo: { priceList: [multiSkuData.skuInfo.priceList[0]] },
      },
      skuReference.url,
    ),
  );

  assert.ok(missingVariant);
  assert.deepEqual(missingVariant.prices, []);
  assert.equal(missingVariant.availability, 'out_of_stock');
});
