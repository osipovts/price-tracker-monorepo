import { marketplaceExitCountries, type MarketplaceType } from 'product-reference';

import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import type { ProxyEntity } from '../domain/proxy.entity.js';
import { ProxyReputationEntity } from '../domain/proxy-reputation.entity.js';
import type { ProxyRepositoryPort } from './proxy-repository.port.js';
import type { ProxyReputationRepositoryPort } from './proxy-reputation-repository.port.js';

/** How many of the proxies by their checks are weighed for a marketplace. */
const candidateLimit = 200;

export interface BestProxyServersQueryInterface {
  /** The proxies exit in the country it serves, and are weighed by how they read it. */
  marketplace: MarketplaceType;
  limit: number;
}

/** A draw from the standard normal distribution, by the Box-Muller transform. */
function standardNormal(random: () => number): number {
  // 1 - random() is in (0, 1], where the logarithm is finite.
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

/**
 * The proxies for the contexts that route through them: the ones added by hand first, whatever their check and
 * country, then the alive proxies of the exit country of the marketplace. A proxy that rests for the marketplace is
 * left out. The rest go in the order of a Thompson sampling: each draws its chance to read the marketplace from its
 * estimate, so the proven ones mostly lead, the ones the marketplace has not seen yet get their turn, and no two jobs
 * go through the same proxies in the same order.
 */
export class ListBestProxyServersUseCase {
  constructor(
    private readonly proxies: ProxyRepositoryPort,
    private readonly reputations: ProxyReputationRepositoryPort,
    private readonly clock: ClockPort = systemClock,
    private readonly random: () => number = Math.random,
  ) {}

  async execute(query: BestProxyServersQueryInterface): Promise<string[]> {
    const manual = await this.proxies.list(
      { manual: true, disabled: false },
      { page: 1, pageSize: candidateLimit },
    );
    const found = await this.proxies.list(
      {
        manual: false,
        alive: true,
        country: marketplaceExitCountries[query.marketplace],
        disabled: false,
      },
      { page: 1, pageSize: candidateLimit },
    );

    const now = this.clock.now();
    const reputations = new Map(
      (
        await this.reputations.findByServers(
          [...manual.items, ...found.items].map(({ snapshot }): string => snapshot.server),
          query.marketplace,
        )
      ).map((reputation): [string, ProxyReputationEntity] => [
        reputation.snapshot.server,
        reputation,
      ]),
    );
    const ranked = (proxies: ProxyEntity[]): string[] =>
      proxies
        .filter(
          ({ snapshot }): boolean => reputations.get(snapshot.server)?.isCooling(now) !== true,
        )
        .map((proxy): { server: string; draw: number } => {
          const { mean, deviation } = ProxyReputationEntity.chanceOf(
            reputations.get(proxy.snapshot.server),
            proxy.successRate,
            now,
          );

          return {
            server: proxy.snapshot.server,
            draw: mean + deviation * standardNormal(this.random),
          };
        })
        .toSorted((a, b): number => b.draw - a.draw)
        .map(({ server }): string => server);

    return [...ranked(manual.items), ...ranked(found.items)].slice(0, query.limit);
  }

  /** The addresses the workers connect to: the servers with their credentials, if they have them. */
  async urlsOf(servers: readonly string[]): Promise<Map<string, string>> {
    const known = await this.proxies.findByServers([...servers]);

    return new Map(known.map((proxy): [string, string] => [proxy.snapshot.server, proxy.routeUrl]));
  }
}
