import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProxyEndpointEntity } from 'proxy-endpoint';

import { CamoufoxOptionsFactory } from './camoufox-options.factory.js';

const factory = new CamoufoxOptionsFactory();

void test('launches a Russian visitor whose place follows the address, headless unless asked otherwise', (): void => {
  assert.deepEqual(factory.launch({ headed: false }), {
    headless: true,
    humanize: true,
    locale: ['ru-RU'],
    geoip: true,
  });
  assert.equal(factory.launch({ headed: true }).headless, false);
  assert.equal(
    factory.launch({ headed: false, executablePath: '/opt/camoufox' }).executable_path,
    '/opt/camoufox',
  );
});

void test('routes a context through the proxy it is given, with the credentials of one that asks for them', (): void => {
  assert.deepEqual(factory.context(null), {});
  assert.deepEqual(
    factory.context(new ProxyEndpointEntity('socks5://217.71.230.1:1080')).proxy?.username,
    undefined,
  );
  assert.deepEqual(factory.context(new ProxyEndpointEntity('socks5://217.71.230.1:1080')), {
    proxy: { server: 'socks5://217.71.230.1:1080' },
  });
  assert.deepEqual(factory.context(new ProxyEndpointEntity('http://user:pass@217.71.230.1:3128')), {
    proxy: { server: 'http://217.71.230.1:3128', username: 'user', password: 'pass' },
  });
});
