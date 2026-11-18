import type { MarketplaceType } from 'product-reference';

import type { RouteInterface } from '../../job/application/index.js';

export interface PriceJobSlotInterface {
  /** The routes with the proxy the job starts on first. */
  routes: RouteInterface[];
  /** How long the job waits in the queue, so that it does not start close behind another one on its proxy. */
  delayMs: number;
}

/**
 * Spreads the jobs that read a marketplace over its proxies: a job starts on the proxy that is free the
 * soonest, so the jobs that run together go out through different proxies; when there are no more free
 * proxies, the jobs of one proxy start a lag apart. Marketplaces are independent: the same proxy may serve
 * two of them at once. What is known of the proxies is kept in memory, since a restart only loses the lag
 * of the jobs that are already in the queue.
 */
export class SpreadPriceJobsUseCase {
  private readonly busyUntil = new Map<string, number>();

  constructor(private readonly lagMs: number) {}

  execute(
    marketplace: MarketplaceType,
    routes: RouteInterface[],
    now: Date,
  ): PriceJobSlotInterface {
    const at = now.getTime();
    this.forgetPast(at);

    const candidates = routes.some(({ server }): boolean => server !== null)
      ? routes.filter(({ server }): boolean => server !== null)
      : routes;
    const [head] = candidates;
    if (head === undefined) return { routes, delayMs: 0 };

    const keyOf = (route: RouteInterface): string => `${marketplace} ${route.server ?? 'direct'}`;
    const freeAt = (route: RouteInterface): number => this.busyUntil.get(keyOf(route)) ?? at;
    const first = candidates.reduce(
      (best, route): RouteInterface => (freeAt(route) < freeAt(best) ? route : best),
      head,
    );
    const startAt = Math.max(freeAt(first), at);
    this.busyUntil.set(keyOf(first), startAt + this.lagMs);

    return {
      routes: [first, ...routes.filter((route): boolean => route !== first)],
      delayMs: startAt - at,
    };
  }

  private forgetPast(at: number): void {
    for (const [key, until] of this.busyUntil) {
      if (until <= at) this.busyUntil.delete(key);
    }
  }
}
