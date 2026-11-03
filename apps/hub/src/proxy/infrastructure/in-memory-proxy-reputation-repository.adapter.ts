import type { MarketplaceType } from 'product-reference';

import type { ProxyReputationRepositoryPort } from '../application/proxy-reputation-repository.port.js';
import type { ProxyReputationEntity } from '../domain/proxy-reputation.entity.js';

export class InMemoryProxyReputationRepositoryAdapter implements ProxyReputationRepositoryPort {
  private readonly reputations = new Map<string, ProxyReputationEntity>();

  findByServers(
    servers: string[],
    marketplace?: MarketplaceType,
  ): Promise<ProxyReputationEntity[]> {
    const wanted = new Set(servers);

    return Promise.resolve(
      Array.from(this.reputations.values()).filter(
        ({ snapshot }): boolean =>
          wanted.has(snapshot.server) &&
          (marketplace === undefined || snapshot.marketplace === marketplace),
      ),
    );
  }

  saveMany(reputations: ProxyReputationEntity[]): Promise<void> {
    for (const reputation of reputations) {
      const { server, marketplace } = reputation.snapshot;
      this.reputations.set(`${marketplace} ${server}`, reputation);
    }

    return Promise.resolve();
  }
}
