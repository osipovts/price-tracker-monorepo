import { afterEach, expect, test, vi } from 'vitest';

import { readRememberedCity, rememberCity } from './city-choice.type.js';

const irkutsk = { value: 'irkutsk-id', label: 'Иркутск (Иркутская область)' };

afterEach((): void => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test('keeps a city for each marketplace apart from the others', () => {
  rememberCity('dns', irkutsk);

  expect(readRememberedCity('dns')).toEqual(irkutsk);
  expect(readRememberedCity('ozon')).toBeNull();
});

test('forgets the city of the marketplace when none is picked', () => {
  rememberCity('dns', irkutsk);
  rememberCity('dns', null);

  expect(readRememberedCity('dns')).toBeNull();
});

test('takes what is kept for no city when it is not one', () => {
  localStorage.setItem('products.city.dns', '{"value":1,"label":"Иркутск"}');
  expect(readRememberedCity('dns')).toBeNull();

  localStorage.setItem('products.city.dns', '{"value":"irkutsk-id"}');
  expect(readRememberedCity('dns')).toBeNull();

  localStorage.setItem('products.city.dns', 'not json');
  expect(readRememberedCity('dns')).toBeNull();
});

test('asks for the city every time when the browser keeps nothing', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((): never => {
    throw new Error('blocked');
  });

  expect((): void => {
    rememberCity('dns', irkutsk);
  }).not.toThrow();
  expect(readRememberedCity('dns')).toBeNull();
});
