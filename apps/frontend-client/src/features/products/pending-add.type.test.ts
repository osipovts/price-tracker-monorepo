import { beforeEach, expect, test } from 'vitest';

import { forgetPendingAdd, readPendingAdd, rememberPendingAdd } from './pending-add.type.js';

beforeEach((): void => {
  sessionStorage.clear();
});

test('gives back the link that is being added, with its city, until it is forgotten', (): void => {
  expect(readPendingAdd()).toBeNull();

  rememberPendingAdd({ url: 'https://ozon.ru/t/AbC', cityId: null, groupId: null });
  expect(readPendingAdd()).toEqual({ url: 'https://ozon.ru/t/AbC', cityId: null, groupId: null });

  rememberPendingAdd({
    url: 'https://www.dns-shop.ru/product/0463bb2411a1d582/',
    cityId: 'irkutsk',
    groupId: 'g1',
  });
  expect(readPendingAdd()).toEqual({
    url: 'https://www.dns-shop.ru/product/0463bb2411a1d582/',
    cityId: 'irkutsk',
    groupId: 'g1',
  });

  forgetPendingAdd();
  expect(readPendingAdd()).toBeNull();
});

test('ignores a record that is too old or malformed', (): void => {
  rememberPendingAdd({ url: 'https://ozon.ru/t/AbC', cityId: null, groupId: null });
  expect(readPendingAdd(Date.now() + 10 * 60_000)).toBeNull();

  sessionStorage.setItem('products.pendingAdd', 'not json');
  expect(readPendingAdd()).toBeNull();
});

test('reads a record made before the city was kept as a link without a city', (): void => {
  sessionStorage.setItem(
    'products.pendingAdd',
    JSON.stringify({ url: 'https://ozon.ru/t/AbC', startedAt: Date.now() }),
  );

  expect(readPendingAdd()).toEqual({ url: 'https://ozon.ru/t/AbC', cityId: null, groupId: null });
});
