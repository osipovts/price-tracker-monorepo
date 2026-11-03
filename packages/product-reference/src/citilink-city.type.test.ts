import assert from 'node:assert/strict';
import { test } from 'node:test';

import { citilinkCities } from './citilink-city.type.js';
import { marketplaceDefaultCities } from './marketplace.type.js';

void test('the cities of Citilink have ids of their own, and the default city is one of them', (): void => {
  assert.equal(new Set(citilinkCities.map((city): string => city.id)).size, citilinkCities.length);
  assert.deepEqual(
    citilinkCities.find((city): boolean => city.id === marketplaceDefaultCities.citilink?.id),
    { id: 'msk_cl', name: 'Москва', region: null },
  );
});

void test('the id of a city is its region on the site, with the town in it after a colon', (): void => {
  for (const city of citilinkCities) assert.match(city.id, /^[a-z]+_cl(?::\w+)?$/, city.name);
});
