import { once } from 'node:events';
import { connect as connectTcp, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';

import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { ProxyEndpointEntity } from 'proxy-endpoint';
import { SocksClient } from 'socks';

import type { RouteProbePort } from '../../application/product/route-probe.port.js';

/** The answer of an HTTP proxy to CONNECT ends with an empty line, and is short. */
const headEnd = '\r\n\r\n';
const maxHeadLength = 8192;

/** A socket whose errors are awaited where it is used: one that comes between the awaits must not end the worker. */
function quiet<Value extends Socket>(socket: Value): Value {
  socket.on('error', (): void => {
    /* Rejected by the wait in progress, or of a socket that is being closed. */
  });

  return socket;
}

/**
 * Checks a route the way a browser starts with it, without asking the site anything: opens a tunnel through the
 * proxy to the host, by CONNECT or SOCKS5, and makes the TLS handshake with the host. A dead or hanging proxy fails
 * it within the time given, which costs seconds instead of a page load that times out.
 */
export class TlsRouteProbeAdapter implements RouteProbePort {
  constructor(
    private readonly timeoutMs: number,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  async reaches(proxy: ProxyEndpointEntity, host: string, signal: AbortSignal): Promise<boolean> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]);
    const sockets: Socket[] = [];
    const startedAt = performance.now();

    try {
      const tunnel = await this.tunnel(proxy, host, deadline, sockets);
      const secure = quiet(connectTls({ socket: tunnel, servername: host }));
      sockets.push(secure);
      await once(secure, 'secureConnect', { signal: deadline });
      this.logger.debug(
        `${proxy.server} reached ${host} in ${String(Math.round(performance.now() - startedAt))} ms`,
      );

      return true;
    } catch (error: unknown) {
      this.logger.debug(`${proxy.server} did not reach ${host}: ${errorMessage(error)}`);

      return false;
    } finally {
      // The outer socket first: a TLS socket over a destroyed one crashes the process.
      for (const socket of sockets.toReversed()) socket.destroy();
    }
  }

  /** A connection to port 443 of the host through the proxy. */
  private async tunnel(
    proxy: ProxyEndpointEntity,
    host: string,
    signal: AbortSignal,
    sockets: Socket[],
  ): Promise<Socket> {
    const url = new URL(proxy.server);
    const port = Number(url.port);

    if (url.protocol === 'socks5:') {
      const { socket } = await SocksClient.createConnection({
        proxy: { host: url.hostname, port, type: 5 },
        command: 'connect',
        destination: { host, port: 443 },
        timeout: this.timeoutMs,
      });
      sockets.push(quiet(socket));

      return socket;
    }

    const socket = quiet(
      url.protocol === 'https:'
        ? connectTls({ host: url.hostname, port })
        : connectTcp({ host: url.hostname, port }),
    );
    sockets.push(socket);
    await once(socket, url.protocol === 'https:' ? 'secureConnect' : 'connect', { signal });

    const credentials =
      proxy.username === ''
        ? ''
        : `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n`;
    socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n${credentials}\r\n`);

    let head = '';
    while (!head.includes(headEnd)) {
      const received: unknown[] = await once(socket, 'data', { signal });
      const chunk = received[0];
      if (!Buffer.isBuffer(chunk) || head.length > maxHeadLength) {
        throw new Error('The proxy did not answer CONNECT');
      }

      head += chunk.toString('latin1');
    }

    const status = /^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1];
    if (status !== '200') throw new Error(`The proxy answered CONNECT with ${status ?? 'garbage'}`);

    return socket;
  }
}
