import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import { test } from 'node:test';

import type { ProxyEndpointEntity } from 'proxy-endpoint';

import { GeoIpProxyProbeAdapter } from './geo-ip-proxy-probe.adapter.js';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject): void => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', (): void => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('No port'));

        return;
      }

      resolve(address.port);
    });
  });
}

void test('an https proxy that hangs up before the TLS handshake is dead, and the process lives on', async (): Promise<void> => {
  // Like a plain http proxy listed as https: it drops the connection on the first bytes of TLS.
  const server = createServer((socket: Socket): void => {
    socket.once('data', (): void => {
      socket.end();
    });
  });
  const port = await listen(server);
  const proxy: ProxyEndpointEntity = {
    server: `https://127.0.0.1:${String(port)}`,
    username: '',
    password: '',
  };

  const result = await new GeoIpProxyProbeAdapter().probe(
    proxy,
    5000,
    new AbortController().signal,
  );
  // The error the socket emits after its end comes on the next turn of the event loop.
  await new Promise((resolve): void => {
    setImmediate(resolve);
  });

  assert.equal(result.alive, false);
  server.close();
});
