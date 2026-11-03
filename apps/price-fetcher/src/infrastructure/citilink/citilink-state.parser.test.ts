import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CitilinkStateParser } from './citilink-state.parser.js';

const parser = new CitilinkStateParser();

const productBase = {
  id: '2194059',
  name: 'Ноутбук ASUS Zenbook A16 UX3607OA-SQ013W',
  isAvailable: true,
  price: { current: '239990', old: '287990', club: '237990', clubPriceViewType: 'PRICE_IN_RUB' },
};

function stateOf(initialState: object): string {
  return JSON.stringify({ props: { pageProps: { initialState }, initialState } });
}

void test('reads the city the page was rendered for and the product of the card', (): void => {
  const state = parser.parse(
    stateOf({
      system: { metadata: { 'x-citilink-city-id': 'krasn_cl:5x0050623' } },
      productPage: { productHeader: { payload: { productBase } } },
    }),
  );

  assert.equal(state?.cityId, 'krasn_cl:5x0050623');
  assert.equal(state.product?.id, '2194059');
  assert.deepEqual(state.product.price, { current: '239990', club: '237990' });
});

void test('a page without a card has no product, and one without a city has none', (): void => {
  assert.deepEqual(parser.parse(stateOf({ system: { metadata: {} } })), {
    cityId: null,
    product: null,
  });
  assert.deepEqual(
    parser.parse(
      stateOf({ productPage: { productHeader: { payload: { productBase: { id: '1' } } } } }),
    ),
    { cityId: null, product: null },
  );
});

void test('text that is not the state of a page is none', (): void => {
  assert.equal(parser.parse(''), null);
  assert.equal(parser.parse('{"props":{}}'), null);
});
