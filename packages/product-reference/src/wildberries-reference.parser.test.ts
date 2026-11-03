import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WildberriesReferenceParser } from './wildberries-reference.parser.js';

const parser = new WildberriesReferenceParser();

void test('canonicalizes the link of a product, with or without its query', (): void => {
  for (const input of [
    'https://www.wildberries.ru/catalog/169684889/detail.aspx',
    'https://wildberries.ru/catalog/169684889/detail.aspx?size=281935741',
    'https://www.wb.ru/catalog/169684889/detail.aspx?targetUrl=GP',
  ]) {
    const reference = parser.parse(new URL(input));

    assert.equal(reference?.marketplace, 'wildberries');
    assert.equal(reference.id, '169684889');
    assert.equal(reference.url, 'https://www.wildberries.ru/catalog/169684889/detail.aspx');
    assert.equal(reference.cityId, null);
  }
});

void test('rejects foreign hosts, credentials, ports, other paths and ids of another shape', (): void => {
  for (const input of [
    'http://www.wildberries.ru/catalog/169684889/detail.aspx',
    'https://wildberries.ru.evil.test/catalog/169684889/detail.aspx',
    'https://wildberries.ru@evil.test/catalog/169684889/detail.aspx',
    'https://www.wildberries.ru:8080/catalog/169684889/detail.aspx',
    'https://www.wildberries.ru/catalog/169684889/feedbacks',
    'https://www.wildberries.ru/catalog/elektronika/noutbuki',
    'https://www.wildberries.ru/catalog/16968a889/detail.aspx',
  ]) {
    assert.equal(parser.parse(new URL(input)), null, input);
  }
});
