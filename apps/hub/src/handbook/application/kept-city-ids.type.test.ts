import assert from 'node:assert/strict';
import { test } from 'node:test';

import { keepCityIds } from './kept-city-ids.type.js';

const spb = { id: '-1205339', name: 'Санкт-Петербург', region: null, aliases: ['-1198680'] };

void test('a city keeps its id while the marketplace still knows it by it', (): void => {
  assert.deepEqual(keepCityIds([spb], [{ ...spb, id: '-1198680', aliases: ['-1205339'] }]), [spb]);
});

void test('a city whose id is gone takes the new one, and keeps the ids it had among its aliases', (): void => {
  const read = { id: '-363610', name: 'Санкт-Петербург', region: null, aliases: ['-1198680'] };

  assert.deepEqual(keepCityIds([spb], [read]), [{ ...read, aliases: ['-1198680', '-1205339'] }]);
});

void test('a city of another name, or that shares no id with it, is another city', (): void => {
  const kolpino = { id: '-1198680', name: 'Колпино', region: null };
  const newTown = { id: '-1', name: 'Санкт-Петербург', region: null };

  assert.deepEqual(keepCityIds([spb], [kolpino, newTown]), [kolpino, newTown]);
});

void test('a city does not keep an id another city of the read has as its own', (): void => {
  const read = [
    { id: '-1198680', name: 'Санкт-Петербург', region: null, aliases: ['-1205339'] },
    { id: '-1205339', name: 'Колпино', region: null },
  ];

  assert.deepEqual(keepCityIds([spb], read), [
    { id: '-1198680', name: 'Санкт-Петербург', region: null, aliases: ['-1205339'] },
    { id: '-1205339', name: 'Колпино', region: null },
  ]);
});

void test('a city that is known by one id stays as it is', (): void => {
  const irkutsk = { id: 'irkutsk', name: 'Иркутск', region: 'Иркутская область' };

  assert.deepEqual(keepCityIds([irkutsk], [irkutsk]), [irkutsk]);
});
