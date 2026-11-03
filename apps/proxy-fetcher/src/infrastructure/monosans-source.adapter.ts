import { type LoggerPort, silentLogger } from 'logger';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ProxySourcePort } from '../application/proxy-source.port.js';
import type { ProxySourceType } from '../domain/proxy-source.type.js';
import { MonosansProxyListParser } from './monosans-proxy-list.parser.js';

export class MonosansSourceAdapter implements ProxySourcePort {
  readonly name: ProxySourceType = 'monosans';

  constructor(
    private readonly parser: MonosansProxyListParser = new MonosansProxyListParser(),
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  /** The list has the proxies of all the countries, a few megabytes: those of Russia are kept. */
  async fetchCandidates(signal: AbortSignal): Promise<ProxyEndpointEntity[]> {
    this.logger.debug('Downloading the proxy list');
    const response = await fetch(
      'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies.json',
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error(`Proxy list returned HTTP ${String(response.status)}`);

    const candidates = this.parser.parse(await response.text(), 'RU');
    this.logger.debug(`Proxy list: ${String(candidates.length)} usable`);

    return candidates;
  }
}
