import { type LoggerPort, silentLogger } from 'logger';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ProxySourcePort } from '../application/proxy-source.port.js';
import type { ProxySourceType } from '../domain/proxy-source.type.js';
import { GeonodeProxyListParser } from './geonode-proxy-list.parser.js';

export class GeonodeSourceAdapter implements ProxySourcePort {
  readonly name: ProxySourceType = 'geonode';

  constructor(
    private readonly parser: GeonodeProxyListParser = new GeonodeProxyListParser(),
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  /** The proxies of Russia checked last, as many as one page of the API holds: a few hundred are listed. */
  async fetchCandidates(signal: AbortSignal): Promise<ProxyEndpointEntity[]> {
    this.logger.debug('Downloading the proxy list');
    const response = await fetch(
      'https://proxylist.geonode.com/api/proxy-list?country=RU&limit=500&page=1&sort_by=lastChecked&sort_type=desc',
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error(`Proxy list returned HTTP ${String(response.status)}`);

    const candidates = this.parser.parse(await response.text());
    this.logger.debug(`Proxy list: ${String(candidates.length)} usable`);

    return candidates;
  }
}
