import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CitilinkReferenceParser } from './citilink-reference.parser.js';

const parser = new CitilinkReferenceParser();

void test('canonicalizes the link of a product, with or without its name', (): void => {
  for (const input of [
    'https://www.citilink.ru/product/noutbuk-asus-zenbook-ux3607oa-sq013w-snapdragon-x2-elite-ex-x2e-94-100-2194059/',
    'https://citilink.ru/product/2194059/',
    'https://www.citilink.ru/product/noutbuk-asus-zenbook-ux3607oa-sq013w-snapdragon-x2-elite-ex-x2e-94-100-2194059/properties/?utm_source=share',
    'https://www.citilink.ru/product/noutbuk-asus-zenbook-ux3607oa-sq013w-snapdragon-x2-elite-ex-x2e-94-100-2194059',
  ]) {
    const reference = parser.parse(new URL(input));

    assert.equal(reference?.marketplace, 'citilink');
    assert.equal(reference.id, '2194059');
    assert.equal(reference.url, 'https://www.citilink.ru/product/2194059/');
    assert.equal(reference.cityId, null);
  }
});

void test('rejects foreign hosts, credentials, ports, other paths and ids of another shape', (): void => {
  for (const input of [
    'http://www.citilink.ru/product/2194059/',
    'https://citilink.ru.evil.test/product/2194059/',
    'https://citilink.ru@evil.test/product/2194059/',
    'https://www.citilink.ru:8080/product/2194059/',
    'https://www.citilink.ru/catalog/noutbuki/',
    'https://www.citilink.ru/product/noutbuk-asus-zenbook/',
    'https://www.citilink.ru/product/noutbuk-2194059x/',
  ]) {
    assert.equal(parser.parse(new URL(input)), null, input);
  }
});
