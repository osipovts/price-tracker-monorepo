import type {
  PageInterface,
  PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { ProxyEntity } from '../domain/proxy.entity.js';
import type { ProxyReputationEntity } from '../domain/proxy-reputation.entity.js';
import type { ProxyRepositoryPort } from './proxy-repository.port.js';
import type { ProxyReputationRepositoryPort } from './proxy-reputation-repository.port.js';

export interface ProxyListFilterInterface {
  alive?: boolean;
  country?: string;
  disabled?: boolean;
}

export interface ProxyListItemInterface {
  proxy: ProxyEntity;
  /** How the proxy has done reading each marketplace it was tried on. */
  reputations: ProxyReputationEntity[];
}

export class ListProxiesUseCase {
  constructor(
    private readonly proxies: ProxyRepositoryPort,
    private readonly reputations: ProxyReputationRepositoryPort,
  ) {}

  async execute(
    filter: ProxyListFilterInterface,
    pagination: PaginationInterface,
  ): Promise<PageInterface<ProxyListItemInterface>> {
    const page = await this.proxies.list(
      {
        ...(filter.alive === undefined ? {} : { alive: filter.alive }),
        ...(filter.country === undefined ? {} : { country: filter.country }),
        ...(filter.disabled === undefined ? {} : { disabled: filter.disabled }),
      },
      pagination,
    );
    const reputations = await this.reputations.findByServers(
      page.items.map(({ snapshot }): string => snapshot.server),
    );

    return {
      ...page,
      items: page.items.map((proxy): ProxyListItemInterface => ({
        proxy,
        reputations: reputations
          .filter(({ snapshot }): boolean => snapshot.server === proxy.snapshot.server)
          .toSorted((a, b): number => a.snapshot.marketplace.localeCompare(b.snapshot.marketplace)),
      })),
    };
  }
}
