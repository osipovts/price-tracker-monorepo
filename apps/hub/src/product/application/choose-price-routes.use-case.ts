import type { MarketplaceType } from 'product-reference';

import type { RouteInterface } from '../../job/application/index.js';
import type { ListBestProxyServersUseCase } from '../../proxy/application/index.js';

/** The ways a job may reach a marketplace, in the order of trying, all of them through a proxy. */
export class ChoosePriceRoutesUseCase {
  constructor(
    private readonly proxyServers: ListBestProxyServersUseCase,
    /** How many of the best proxies a job may try. */
    private readonly proxyCount: number,
  ) {}

  /** None is an empty list. */
  async execute(marketplace: MarketplaceType): Promise<RouteInterface[]> {
    // The proxies exit in the country of the marketplace: the workers reject others anyway.
    const best = await this.proxyServers.execute({ marketplace, limit: this.proxyCount });

    // The workers connect with the credentials of a proxy, which the hub keeps apart from its server.
    const urls = await this.proxyServers.urlsOf(best);

    return best.map((server): RouteInterface => ({ server: urls.get(server) ?? server }));
  }
}
