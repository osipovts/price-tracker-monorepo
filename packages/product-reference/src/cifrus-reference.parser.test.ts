import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CifrusReferenceParser } from './cifrus-reference.parser.js';

const parser = new CifrusReferenceParser();

void test('canonicalizes the link of a product across hosts, subpages, slashes and case', (): void => {
  for (const input of [
    'https://www.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520',
    'https://cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520/',
    'https://spb.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520',
    'https://www.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520/harakteristiki',
    'https://www.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520/otzyvy/',
    'https://www.cifrus.ru/description/1/APPLE_IPHONE_17_256GB_WHITE_A3520?utm_source=test',
  ]) {
    const reference = parser.parse(new URL(input));

    assert.equal(reference?.marketplace, 'cifrus');
    assert.equal(reference.id, '1/apple_iphone_17_256gb_white_a3520');
    assert.equal(
      reference.url,
      'https://www.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520',
    );
    assert.equal(reference.cityId, null);
  }
});

void test('rejects foreign hosts, multi-level subdomains, credentials, ports and other paths', (): void => {
  for (const input of [
    'http://www.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520',
    'https://cifrus.ru.evil.test/description/1/apple_iphone_17_256gb_white_a3520',
    'https://a.b.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520',
    'https://www.cifrus.ru@evil.test/description/1/apple_iphone_17_256gb_white_a3520',
    'https://www.cifrus.ru:8080/description/1/apple_iphone_17_256gb_white_a3520',
    'https://www.cifrus.ru/catalog/smartfony/apple',
    'https://www.cifrus.ru/buy/apple-iphone-17.html',
    'https://www.cifrus.ru/description/smartfony/apple_iphone_17',
    'https://www.cifrus.ru/description/1/apple_iphone_17/other',
  ]) {
    assert.equal(parser.parse(new URL(input)), null, input);
  }
});
