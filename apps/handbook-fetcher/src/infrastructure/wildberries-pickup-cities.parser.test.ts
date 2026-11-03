import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WildberriesPickupCitiesParser } from './wildberries-pickup-cities.parser.js';

const parser = new WildberriesPickupCitiesParser();

void test('reads the town of an address however the address is written', (): void => {
  const cities = parser.parse([
    {
      address:
        'Россия, респ. Дагестан, г.о. Махачкала, г. Махачкала, ул. Братьев Нурбагандовых, 12',
      dest: -5921133,
    },
    { address: 'Пермь, Улица Охотников 34а', dest: -1 },
    { address: 'г. Симферополь, Московское шоссе 12 км', dest: -2 },
    { address: 'Ставропольский край, Михайловск, улица Войкова, 228А', dest: -3 },
    { address: 'Амурская область, Свободный, улица 50 лет Октября, 13', dest: -4 },
  ]);

  assert.deepEqual(
    cities.map((city): string => `${city.name}|${city.region ?? '-'}|${city.id}`),
    [
      'Махачкала|респ. Дагестан|-5921133',
      'Пермь|-|-1',
      'Симферополь|-|-2',
      'Михайловск|Ставропольский край|-3',
      'Свободный|Амурская область|-4',
    ],
  );
});

void test('leaves out villages and addresses that name no settlement', (): void => {
  assert.deepEqual(
    parser.parse([
      { address: 'село Бахметьево, Центральная Улица 4', dest: -1 },
      { address: 'с Большие Ремезенки, ул Молодежная стр. 1В', dest: -1 },
      { address: 'посёлок городского типа Бутово, Жилой Комплекс Бутово Парк 5', dest: -1 },
      {
        address: 'Россия, Московская обл., Одинцовский г.о., пгт. Новоивановское, Западная ул., 85',
        dest: -1,
      },
      { address: 'деревня Струбково, Центральная Улица 8', dest: -1 },
      {
        address: 'Республика Саха (Якутия), село Бердигестях, улица Семена Данилова, 26',
        dest: -1,
      },
      { address: 'ул. Ленина, 5', dest: -1 },
    ]),
    [],
  );
});

void test('a town is one whichever way its region is written, and the points without one join it', (): void => {
  const cities = parser.parse([
    { address: 'Россия, Иркутская обл., г. Иркутск, ул. Лермонтова, 1', dest: -5827226 },
    { address: 'Россия, Иркутская область, г. Иркутск, ул. Ленина, 2', dest: -5827226 },
    { address: 'Иркутск, Улица Безбокова 7/2', dest: -5827642 },
  ]);

  assert.deepEqual(cities, [
    { id: '-5827226', name: 'Иркутск', region: 'Иркутская обл.', aliases: ['-5827642'] },
  ]);
});

void test('towns of one name in different regions are different towns', (): void => {
  const cities = parser.parse([
    { address: 'Россия, Мурманская обл., г. Кировск, ул. Мира, 1', dest: 123585549 },
    { address: 'Россия, Ленинградская обл., г. Кировск, ул. Победы, 2', dest: -1703911 },
  ]);

  assert.deepEqual(
    cities.map((city): string => `${city.region ?? '-'}|${city.id}`),
    ['Мурманская обл.|123585549', 'Ленинградская обл.|-1703911'],
  );
});

void test('the id of a town is the region most of its points have, the lowest of equals', (): void => {
  const point = (dest: number): { address: string; dest: number } => ({
    address: 'Москва, Улица Тверская 1',
    dest,
  });

  assert.equal(parser.parse([point(-442733), point(-1257403), point(-1257403)])[0]?.id, '-1257403');
  assert.equal(parser.parse([point(-442733), point(-1257403)])[0]?.id, '-1257403');
  assert.equal(parser.parse([point(-1257403), point(-442733)])[0]?.id, '-1257403');
});

void test('two towns of one region id are one, named after the one with more points', (): void => {
  const cities = parser.parse([
    { address: 'г Москва, Улица Тверская 1', dest: -1257403 },
    { address: 'Москва, Улица Арбат 2', dest: -1257403 },
    { address: 'Россия, Москва, Пресненская наб., 3', dest: -1257403 },
  ]);

  assert.deepEqual(cities, [{ id: '-1257403', name: 'Москва', region: null, aliases: [] }]);
});

void test('a town written two ways keeps the aliases of both', (): void => {
  const cities = parser.parse([
    { address: 'Россия, Московская обл., г. Москва, ул. Тверская, 1', dest: -1257403 },
    { address: 'Россия, Московская обл., г. Москва, ул. Арбат, 2', dest: -1257403 },
    { address: 'Россия, Московская обл., г. Москва, ул. Мира, 3', dest: -442733 },
    { address: 'Россия, Тверская обл., г. Москва, ул. Ленина, 4', dest: -1257403 },
    { address: 'Россия, Тверская обл., г. Москва, ул. Ленина, 5', dest: -1257403 },
    { address: 'Россия, Тверская обл., г. Москва, ул. Ленина, 6', dest: -428431 },
  ]);

  assert.deepEqual(cities, [
    {
      id: '-1257403',
      name: 'Москва',
      region: 'Московская обл.',
      aliases: ['-428431', '-442733'],
    },
  ]);
});
