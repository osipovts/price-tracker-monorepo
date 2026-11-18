import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SportmasterReferenceParser } from './sportmaster-reference.parser.js';

const parser = new SportmasterReferenceParser();

void test('canonicalizes the link of a product', (): void => {
  for (const input of [
    'https://www.sportmaster.ru/product/33427090299/',
    'https://sportmaster.ru/product/33427090299',
    'https://www.sportmaster.ru/product/33427090299/?utm_source=share',
  ]) {
    const reference = parser.parse(new URL(input));

    assert.equal(reference?.marketplace, 'sportmaster');
    assert.equal(reference.id, '33427090299');
    assert.equal(reference.url, 'https://www.sportmaster.ru/product/33427090299/');
    assert.equal(reference.cityId, null);
  }
});

void test('rejects foreign hosts, credentials, ports, other paths and ids of another shape', (): void => {
  for (const input of [
    'http://www.sportmaster.ru/product/33427090299/',
    'https://sportmaster.ru.evil.test/product/33427090299/',
    'https://sportmaster.ru@evil.test/product/33427090299/',
    'https://www.sportmaster.ru:8080/product/33427090299/',
    'https://www.sportmaster.ru/catalog/elektronika/',
    'https://www.sportmaster.ru/product/33427090299/reviews/',
    'https://www.sportmaster.ru/product/naushniki-33427090299/',
  ]) {
    assert.equal(parser.parse(new URL(input)), null, input);
  }
});
