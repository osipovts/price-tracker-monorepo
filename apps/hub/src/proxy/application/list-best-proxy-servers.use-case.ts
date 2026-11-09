import { marketplaceExitCountries, type MarketplaceType } from 'product-reference';

import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import type { ProxyEntity } from '../domain/proxy.entity.js';
import { ProxyReputationEntity } from '../domain/proxy-reputation.entity.js';
import type { ProxyRepositoryPort } from './proxy-repository.port.js';
import type { ProxyReputationRepositoryPort } from './proxy-reputation-repository.port.js';

/** How many of the proxies by their checks are weighed for a marketplace. */
const candidateLimit = 200;

/** A route of the list of every this many goes to a proxy the marketplace is still learned on. */
const routesPerExplorer = 4;

/** How many routes at most go to such proxies. */
const explorerLimit = 2;

/** How often a list starts on a proxy that is learned on, so that it is tried even when the others read. */
const explorerLeadChance = 0.15;

export interface BestProxyServersQueryInterface {
  /** The proxies exit in the country it serves, and are weighed by how they read it. */
  marketplace: MarketplaceType;
  limit: number;
}

/** A proxy with its chance to read the marketplace, as estimated and as drawn for the list. */
interface WeighedProxyInterface {
  server: string;
  mean: number;
  draw: number;
}

/** A draw from the standard normal distribution, by the Box-Muller transform. */
function standardNormal(random: () => number): number {
  // 1 - random() is in (0, 1], where the logarithm is finite.
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function byMean(a: WeighedProxyInterface, b: WeighedProxyInterface): number {
  return b.mean - a.mean || b.draw - a.draw;
}

function byDraw(a: WeighedProxyInterface, b: WeighedProxyInterface): number {
  return b.draw - a.draw;
}

/**
 * The proxies for the contexts that route through them: the ones added by hand first, whatever their check and
 * country, then the alive proxies of the exit country of the marketplace. A proxy that rests for the marketplace, or
 * that the last attempt through it found down wherever it went, is left out. The others go by their chance to read
 * the marketplace, the proven ones first; a few routes at the end go to the proxies drawn by a Thompson sampling
 * among the rest, so that the marketplace is learned on new proxies at a cost the list can bear, and now and then
 * one of them leads.
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
    const known = await this.reputations.findByServers(
      [...manual.items, ...found.items].map(({ snapshot }): string => snapshot.server),
    );
    const byServer = new Map<string, ProxyReputationEntity[]>();
    for (const reputation of known) {
      const { server } = reputation.snapshot;
      byServer.set(server, [...(byServer.get(server) ?? []), reputation]);
    }

    const ofMarketplace = known.filter(
      ({ snapshot }): boolean => snapshot.marketplace === query.marketplace,
    );
    const reputations = new Map(
      ofMarketplace.map((reputation): [string, ProxyReputationEntity] => [
        reputation.snapshot.server,
        reputation,
      ]),
    );
    const baseRate = ProxyReputationEntity.baseRateOf(ofMarketplace, now);
    const weighed = (proxies: ProxyEntity[]): WeighedProxyInterface[] =>
      proxies
        .filter(
          ({ snapshot }): boolean =>
            reputations.get(snapshot.server)?.isCooling(now) !== true &&
            !ProxyReputationEntity.isDown(byServer.get(snapshot.server) ?? [], now),
        )
        .map(({ snapshot }): WeighedProxyInterface => {
          const { mean, deviation } = ProxyReputationEntity.chanceOf(
            reputations.get(snapshot.server),
            baseRate,
            now,
          );

          return {
            server: snapshot.server,
            mean,
            draw: mean + deviation * standardNormal(this.random),
          };
        });

    const first = weighed(manual.items).toSorted(byMean);

    return [...first, ...this.arranged(weighed(found.items), query.limit - first.length)]
      .slice(0, query.limit)
      .map(({ server }): string => server);
  }

  /** The addresses the workers connect to: the servers with their credentials, if they have them. */
  async urlsOf(servers: readonly string[]): Promise<Map<string, string>> {
    const known = await this.proxies.findByServers([...servers]);

    return new Map(known.map((proxy): [string, string] => [proxy.snapshot.server, proxy.routeUrl]));
  }

  /** The best by their chance, then the explorers drawn among the rest; now and then an explorer leads. */
  private arranged(proxies: WeighedProxyInterface[], slots: number): WeighedProxyInterface[] {
    const explorers = Math.min(Math.floor(Math.max(slots, 0) / routesPerExplorer), explorerLimit);
    const ranked = proxies.toSorted(byMean);
    const best = ranked.slice(0, Math.max(slots - explorers, 0));
    const drawn = ranked.slice(best.length).toSorted(byDraw).slice(0, explorers);
    const [lead, ...others] = drawn;

    return lead !== undefined && this.random() < explorerLeadChance
      ? [lead, ...best, ...others]
      : [...best, ...drawn];
  }
}
