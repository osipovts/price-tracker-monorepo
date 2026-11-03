import assert from 'node:assert/strict';
import { test } from 'node:test';

import { marketplaceDefaultCities } from './marketplace.type.js';
import { ozonCities } from './ozon-city.type.js';

void test('the cities of Ozon have ids of their own, and the default city is one of them', (): void => {
  assert.equal(new Set(ozonCities.map((city): string => city.id)).size, ozonCities.length);
  assert.deepEqual(
    ozonCities.find((city): boolean => city.id === marketplaceDefaultCities.ozon?.id),
    { id: 'moskva', name: 'Москва', region: null, latitude: 55.7299, longitude: 37.5907 },
  );
});

void test('the cities of Ozon are in Russia', (): void => {
  for (const city of ozonCities) {
    assert.ok(city.latitude > 41 && city.latitude < 82, city.id);
    assert.ok(city.longitude > 19 || city.longitude < -168, city.id);
  }
});
