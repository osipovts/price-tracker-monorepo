import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MonosansProxyListParser } from './monosans-proxy-list.parser.js';

const parser = new MonosansProxyListParser();

function proxyIn(country: string | null, protocol: string, host: string, port: number): object {
  return {
    protocol,
    host,
    port,
    // The field is named so by the list.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    geolocation: country === null ? null : { country: { iso_code: country } },
  };
}

void test('keeps the proxies of the country, skipping the unsupported ones and the repeated', (): void => {
  const text = JSON.stringify([
    proxyIn('RU', 'http', '185.21.156.73', 4080),
    proxyIn('DE', 'socks5', '31.77.175.15', 1080),
    proxyIn('RU', 'socks4', '95.68.196.105', 10808),
    proxyIn(null, 'http', '1.1.1.1', 80),
    proxyIn('RU', 'socks5', '90.188.20.181', 1080),
    proxyIn('RU', 'http', '185.21.156.73', 4080),
    { host: '185.21.156.74' },
  ]);

  assert.deepEqual(
    parser.parse(text, 'RU').map(({ server }): string => server),
    ['http://185.21.156.73:4080', 'socks5://90.188.20.181:1080'],
  );
});

void test('a text that is not a list of proxies gives none', (): void => {
  assert.deepEqual(parser.parse('', 'RU'), []);
  assert.deepEqual(parser.parse('{"proxies":[]}', 'RU'), []);
});
