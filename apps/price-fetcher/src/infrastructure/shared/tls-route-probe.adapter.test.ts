import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, test } from 'node:test';

import type { ProxyEndpointEntity } from 'proxy-endpoint';

import { TlsRouteProbeAdapter } from './tls-route-probe.adapter.js';

const servers: Server[] = [];
afterEach((): void => {
  for (const server of servers.splice(0)) server.close();
});

/** A local HTTP proxy that does with a connection what it is told; the entity refuses local addresses. */
async function proxyThat(handle: (socket: Socket) => void): Promise<ProxyEndpointEntity> {
  const server = createServer(handle);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');

  return { server: `http://127.0.0.1:${String(address.port)}`, username: '', password: '' };
}

void test('a proxy that refuses to open the tunnel does not reach the site', async (): Promise<void> => {
  const requests: string[] = [];
  const proxy = await proxyThat((socket): void => {
    socket.once('data', (chunk): void => {
      requests.push(chunk.toString('latin1').split('\r\n')[0] ?? '');
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    });
  });

  const reaches = await new TlsRouteProbeAdapter(2000).reaches(
    proxy,
    'www.ozon.ru',
    new AbortController().signal,
  );

  assert.equal(reaches, false);
  assert.deepEqual(requests, ['CONNECT www.ozon.ru:443 HTTP/1.1']);
});

void test('a proxy that does not answer fails within the time given', async (): Promise<void> => {
  const proxy = await proxyThat((): void => {
    /* Holds the connection without a word. */
  });
  const startedAt = performance.now();

  const reaches = await new TlsRouteProbeAdapter(1000).reaches(
    proxy,
    'www.ozon.ru',
    new AbortController().signal,
  );

  assert.equal(reaches, false);
  assert.ok(performance.now() - startedAt < 1500);
});

void test('a proxy that is not listening does not reach the site', async (): Promise<void> => {
  const proxy = await proxyThat((): void => {
    /* Closed below. */
  });
  for (const server of servers.splice(0)) server.close();

  assert.equal(
    await new TlsRouteProbeAdapter(1000).reaches(
      proxy,
      'www.ozon.ru',
      new AbortController().signal,
    ),
    false,
  );
});
