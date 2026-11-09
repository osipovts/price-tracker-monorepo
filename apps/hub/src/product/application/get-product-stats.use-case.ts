import { marketplaces, type MarketplaceType } from 'product-reference';

import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import type { PriceObservationRepositoryPort } from './price-observation-repository.port.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';
import type { TrackedProductRepositoryPort } from './tracked-product-repository.port.js';

/** A product whose newest price is older than this is behind its schedule by far. */
export const productStaleAfterMs = 3 * 60 * 60_000;

const hourMs = 60 * 60_000;

const dayMs = 24 * hourMs;

/** How the prices of a marketplace are read. */
export interface MarketplaceReadsInterface {
  marketplace: MarketplaceType;
  /** The products somebody tracks. */
  products: number;
  /** The prices read in the last day. */
  readsLastDay: number;
  /** The newest read; null while none was. */
  lastReadAt: Date | null;
  /** The products read once, whose newest price is older than `productStaleAfterMs`. */
  stale: number;
  /** The products whose price was never read. */
  unread: number;
}

/** The prices of a marketplace read in an hour. */
export interface ReadHourInterface {
  /** The start of the hour. */
  hour: Date;
  marketplace: MarketplaceType;
  reads: number;
}

export interface ProductStatsInterface {
  products: number;
  /** What users track in all: a product that two of them track counts twice. */
  trackings: number;
  groups: number;
  /** In the order of the marketplaces. */
  marketplaces: MarketplaceReadsInterface[];
  /** The reads of the last day by the hour and the marketplace, the oldest first; an hour with none is left out. */
  readsByHour: ReadHourInterface[];
}

export class GetProductStatsUseCase {
  constructor(
    private readonly products: TrackedProductRepositoryPort,
    private readonly groups: ProductGroupRepositoryPort,
    private readonly observations: PriceObservationRepositoryPort,
    private readonly clock: ClockPort = systemClock,
  ) {}

  async execute(): Promise<ProductStatsInterface> {
    const now = this.clock.now().getTime();
    const [totals, groups, tracked] = await Promise.all([
      this.products.stats(),
      this.groups.listAll({ page: 1, pageSize: 1 }),
      this.products.listTracked(),
    ]);
    const ids = tracked.map(({ snapshot }): string => snapshot.id);
    const [latest, lastDay] = await Promise.all([
      this.observations.findLatestByProducts(ids),
      this.observations.listSince(ids, new Date(now - dayMs)),
    ]);
    const marketplaceOf = new Map(
      tracked.map(({ snapshot }): [string, MarketplaceType] => [snapshot.id, snapshot.marketplace]),
    );
    const lastReadOf = new Map(
      latest.map((observation): [string, Date] => [
        observation.trackedProductId,
        observation.observedAt,
      ]),
    );

    return {
      ...totals,
      groups: groups.total,
      marketplaces: marketplaces.map((marketplace): MarketplaceReadsInterface => {
        const own = ids.filter((id): boolean => marketplaceOf.get(id) === marketplace);
        const lastReads = own.flatMap((id): Date[] => {
          const at = lastReadOf.get(id);

          return at === undefined ? [] : [at];
        });
        const newest = Math.max(...lastReads.map((at): number => at.getTime()));

        return {
          marketplace,
          products: own.length,
          readsLastDay: lastDay.filter(
            ({ trackedProductId }): boolean => marketplaceOf.get(trackedProductId) === marketplace,
          ).length,
          lastReadAt: lastReads.length === 0 ? null : new Date(newest),
          stale: lastReads.filter((at): boolean => now - at.getTime() > productStaleAfterMs).length,
          unread: own.length - lastReads.length,
        };
      }),
      readsByHour: this.byHour(
        lastDay.flatMap(({ trackedProductId, observedAt }) => {
          const marketplace = marketplaceOf.get(trackedProductId);

          return marketplace === undefined ? [] : [{ marketplace, observedAt }];
        }),
      ),
    };
  }

  private byHour(
    reads: Array<{ marketplace: MarketplaceType; observedAt: Date }>,
  ): ReadHourInterface[] {
    const hours = new Map<string, ReadHourInterface>();
    for (const { marketplace, observedAt } of reads) {
      const hour = Math.floor(observedAt.getTime() / hourMs) * hourMs;
      const key = `${String(hour)} ${marketplace}`;
      const known = hours.get(key) ?? { hour: new Date(hour), marketplace, reads: 0 };
      known.reads += 1;
      hours.set(key, known);
    }

    return [...hours.values()].toSorted(
      (a, b): number =>
        a.hour.getTime() - b.hour.getTime() ||
        marketplaces.indexOf(a.marketplace) - marketplaces.indexOf(b.marketplace),
    );
  }
}
