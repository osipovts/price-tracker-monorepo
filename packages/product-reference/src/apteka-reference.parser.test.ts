import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AptekaReferenceParser } from './apteka-reference.parser.js';

const parser = new AptekaReferenceParser();

void test('canonicalizes the link of a product across hosts, city prefixes, slugs and case', (): void => {
  for (const input of [
    'https://apteka.ru/product/jodomarin-200-50-sht-tabletki-5e32674d65b5ab0001650ab2/',
    'https://www.apteka.ru/product/jodomarin-200-50-sht-tabletki-5e32674d65b5ab0001650ab2',
    'https://apteka.ru/product/5e32674d65b5ab0001650ab2/',
    'https://apteka.ru/irkutsk/product/jodomarin-200-50-sht-tabletki-5e32674d65b5ab0001650ab2/',
    'https://apteka.ru/kirov-kaluzhskaya-oblast/product/5e32674d65b5ab0001650ab2/',
    'https://apteka.ru/product/5E32674D65B5AB0001650AB2/?utm_source=test',
  ]) {
    const reference = parser.parse(new URL(input));

    assert.equal(reference?.marketplace, 'apteka');
    assert.equal(reference.id, '5e32674d65b5ab0001650ab2');
    assert.equal(reference.url, 'https://apteka.ru/product/5e32674d65b5ab0001650ab2/');
    assert.equal(reference.cityId, null);
  }
});

void test('rejects foreign hosts, credentials, ports, other paths and ids of another shape', (): void => {
  for (const input of [
    'http://apteka.ru/product/5e32674d65b5ab0001650ab2/',
    'https://apteka.ru.evil.test/product/5e32674d65b5ab0001650ab2/',
    'https://spb.apteka.ru/product/5e32674d65b5ab0001650ab2/',
    'https://apteka.ru@evil.test/product/5e32674d65b5ab0001650ab2/',
    'https://apteka.ru:8080/product/5e32674d65b5ab0001650ab2/',
    'https://apteka.ru/search/?q=test',
    'https://apteka.ru/product/abc/',
    'https://apteka.ru/product/5e32674d65b5ab0001650ab2/reviews/',
    'https://apteka.ru/a/b/product/5e32674d65b5ab0001650ab2/',
    'https://apteka.ru/product/5e32674d65b5ab0001650ab/',
    'https://apteka.ru/product/5e32674d65b5ab0001650ab2a/',
  ]) {
    assert.equal(parser.parse(new URL(input)), null, input);
  }
});
