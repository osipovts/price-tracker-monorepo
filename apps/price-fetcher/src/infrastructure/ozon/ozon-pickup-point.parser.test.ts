import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OzonPickupPointParser } from './ozon-pickup-point.parser.js';

const parser = new OzonPickupPointParser();

void test('reads the first pickup point the answer links to, in a link or an encoded one', (): void => {
  assert.equal(
    parser.parse(
      '{"link":"/modal/commonDelivery?pid=5&pp=1261805&tab=pp"},{"link":"pp=10901200004"}',
    ),
    '1261805',
  );
  assert.equal(parser.parse('url=%2Fmodal%2FcommonDelivery%3Fpid%3D5%26pp%3D2643518'), '2643518');
});

void test('is null for an answer that names no point', (): void => {
  assert.equal(parser.parse('{"layout":[]}'), null);
  assert.equal(parser.parse('pp=12'), null);
});
