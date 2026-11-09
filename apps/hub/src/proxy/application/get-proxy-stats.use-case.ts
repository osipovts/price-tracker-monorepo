import { marketplaces, type MarketplaceType } from 'product-reference';

import type { ListBestProxyServersUseCase } from './list-best-proxy-servers.use-case.js';
import type { ProxyRepositoryPort, StoredProxyStatsInterface } from './proxy-repository.port.js';

export type { ProxySourceStatsInterface } from './proxy-repository.port.js';

/** More than the workers are ever given for a marketplace: every proxy that may be given is counted. */
const usableLimit = 1000;

export interface UsableProxiesInterface {
  marketplace: MarketplaceType;
  /** The proxies a read of the marketplace may be given now: not resting for it, not down, not turned off. */
  count: number;
}

export interface ProxyStatsInterface extends StoredProxyStatsInterface {
  /** By marketplace, in the order of the marketplaces. */
  usable: UsableProxiesInterface[];
}

export class GetProxyStatsUseCase {
  constructor(
    private readonly proxies: ProxyRepositoryPort,
    private readonly best: Pick<ListBestProxyServersUseCase, 'execute'>,
  ) {}

  async execute(): Promise<ProxyStatsInterface> {
    const [stored, usable] = await Promise.all([
      this.proxies.stats(),
      Promise.all(
        marketplaces.map(async (marketplace): Promise<UsableProxiesInterface> => ({
          marketplace,
          count: (await this.best.execute({ marketplace, limit: usableLimit })).length,
        })),
      ),
    ]);

    return { ...stored, usable };
  }
}
