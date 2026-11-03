import type { MarketplaceType } from 'product-reference';

import type { ProxyReputationEntity } from '../domain/proxy-reputation.entity.js';

export const PROXY_REPUTATION_REPOSITORY = Symbol('ProxyReputationRepositoryPort');

export interface ProxyReputationRepositoryPort {
  /** The reputations of the proxies, for the marketplace, or for every marketplace when it is omitted. */
  findByServers(servers: string[], marketplace?: MarketplaceType): Promise<ProxyReputationEntity[]>;
  /** Each reputation must be of a stored proxy: it is deleted with the proxy. */
  saveMany(reputations: ProxyReputationEntity[]): Promise<void>;
}
