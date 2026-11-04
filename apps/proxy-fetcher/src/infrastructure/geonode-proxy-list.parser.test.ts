import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GeonodeProxyListParser } from './geonode-proxy-list.parser.js';

const parser = new GeonodeProxyListParser();

void test('takes a proxy with each protocol it speaks, skipping the unsupported ones and the repeated, https as http', (): void => {
  const text = JSON.stringify({
    data: [
      { ip: '90.188.20.181', port: '1080', protocols: ['socks5'], upTime: 100 },
      { ip: '95.68.196.105', port: '10808', protocols: ['socks4'] },
      { ip: '31.25.28.203', port: 8080, protocols: ['http', 'https'] },
      { ip: '90.188.20.181', port: '1080', protocols: ['socks5'] },
      { ip: '10.0.0.1', port: '3128', protocols: ['http'] },
    ],
    total: 5,
    page: 1,
    limit: 500,
  });

  assert.deepEqual(
    parser.parse(text).map(({ server }): string => server),
    ['socks5://90.188.20.181:1080', 'http://31.25.28.203:8080'],
  );
});

void test('an answer that is not a list of proxies gives none', (): void => {
  assert.deepEqual(parser.parse(''), []);
  assert.deepEqual(parser.parse('{"message":"Too many requests"}'), []);
});
