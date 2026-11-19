import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AliexpressReferenceParser } from './aliexpress-reference.parser.js';

const parser = new AliexpressReferenceParser();

void test('canonicalizes the link of a product without sku_id', (): void => {
  for (const input of [
    'https://aliexpress.ru/item/1005012815784218.html',
    'https://www.aliexpress.ru/item/1005012815784218.html',
    'https://aliexpress.ru/item/0_1005012815784218.html',
    'https://aliexpress.ru/item/1005012815784218.html?sku_id=0',
    'https://aliexpress.ru/item/1005012815784218.html?sku_id=invalid',
  ]) {
    const reference = parser.parse(new URL(input));

    assert.equal(reference?.marketplace, 'aliexpress');
    assert.equal(reference.id, '1005012815784218');
    assert.equal(reference.url, 'https://aliexpress.ru/item/1005012815784218.html');
    assert.equal(reference.cityId, null);
  }
});

void test('preserves sku_id in the product reference id and canonical url', (): void => {
  for (const input of [
    'https://aliexpress.ru/item/1005006652949835.html?sku_id=12000037931516788',
    'https://www.aliexpress.ru/item/0_1005006652949835.html?sku_id=12000037931516788&spm=a2g2w',
  ]) {
    const reference = parser.parse(new URL(input));

    assert.equal(reference?.marketplace, 'aliexpress');
    assert.equal(reference.id, '1005006652949835:12000037931516788');
    assert.equal(
      reference.url,
      'https://aliexpress.ru/item/1005006652949835.html?sku_id=12000037931516788',
    );
    assert.equal(reference.cityId, null);
  }

  assert.deepEqual(AliexpressReferenceParser.splitId('1005006652949835'), {
    itemId: '1005006652949835',
    skuId: null,
  });
  assert.deepEqual(AliexpressReferenceParser.splitId('1005006652949835:12000037931516788'), {
    itemId: '1005006652949835',
    skuId: '12000037931516788',
  });
});

void test('rejects foreign hosts, credentials, ports, other paths and ids of another shape', (): void => {
  for (const input of [
    'http://aliexpress.ru/item/1005012815784218.html',
    'https://aliexpress.ru.evil.test/item/1005012815784218.html',
    'https://www.aliexpress.com/item/1005012815784218.html',
    'https://aliexpress.ru@evil.test/item/1005012815784218.html',
    'https://aliexpress.ru:8080/item/1005012815784218.html',
    'https://aliexpress.ru/wholesale',
    'https://aliexpress.ru/item/1005012815784218/reviews.html',
    'https://aliexpress.ru/item/abc.html',
  ]) {
    assert.equal(parser.parse(new URL(input)), null, input);
  }
});
