import type { MarketplaceType } from 'product-reference';

import type { PriceObservationInterface } from '../domain/price-observation.interface.js';
import { statsPeriodMs, type StatsPeriodType } from '../domain/stats-period.type.js';

export interface GroupPriceInterface {
  marketplace: MarketplaceType;
  /** In kopecks. */
  amountMinor: number;
  observedAt: Date;
}

export interface GroupPriceSummaryInterface {
  /** The cheapest of the newest reads of the products that are in stock; null when none is. */
  current: GroupPriceInterface | null;
  /** The lowest and the highest price of the period, not counting the newest read of each product. */
  min: GroupPriceInterface | null;
  max: GroupPriceInterface | null;
  /** The current price is not above the lowest of the period: a good moment to buy. */
  highlighted: boolean;
}

/** The price of an observation that can be bought: the first the marketplace showed, while the product is in stock. */
function offerOf(
  observation: PriceObservationInterface,
  marketplaces: ReadonlyMap<string, MarketplaceType>,
): GroupPriceInterface | null {
  const marketplace = marketplaces.get(observation.trackedProductId);
  const amountMinor = observation.prices[0]?.amountMinor;
  if (
    marketplace === undefined ||
    amountMinor === undefined ||
    observation.availability !== 'in_stock'
  ) {
    return null;
  }

  return { marketplace, amountMinor, observedAt: observation.observedAt };
}

function isNewer(candidate: GroupPriceInterface, other: GroupPriceInterface): boolean {
  return candidate.observedAt.getTime() > other.observedAt.getTime();
}

/** The one of the prices that wins by `better`; of equal ones, the newer. */
function pick(
  prices: readonly GroupPriceInterface[],
  better: (candidate: number, other: number) => boolean,
): GroupPriceInterface | null {
  return prices.reduce<GroupPriceInterface | null>((best, price): GroupPriceInterface => {
    if (best === null) return price;
    if (price.amountMinor === best.amountMinor) return isNewer(price, best) ? price : best;

    return better(price.amountMinor, best.amountMinor) ? price : best;
  }, null);
}

/**
 * What the products of a group cost: the best price now, and how it stands against the period. `observations`
 * are those of the products from the start of the period on, at least; a product not read since the start has
 * its newest read among them still, which is then the current one and left out of the period.
 */
export function summarizeGroupPrices({
  products,
  observations,
  period,
  now,
}: {
  products: ReadonlyArray<{ id: string; marketplace: MarketplaceType }>;
  observations: readonly PriceObservationInterface[];
  period: StatsPeriodType;
  now: Date;
}): GroupPriceSummaryInterface {
  const marketplaces = new Map(products.map(({ id, marketplace }) => [id, marketplace]));
  const since = now.getTime() - statsPeriodMs[period];

  const newest = new Map<string, PriceObservationInterface>();
  for (const observation of observations) {
    const known = newest.get(observation.trackedProductId);
    if (known === undefined || observation.observedAt > known.observedAt) {
      newest.set(observation.trackedProductId, observation);
    }
  }

  const current = pick(
    [...newest.values()].flatMap((observation): GroupPriceInterface[] => {
      const offer = offerOf(observation, marketplaces);

      return offer === null ? [] : [offer];
    }),
    (candidate, other): boolean => candidate < other,
  );
  const earlier = observations.flatMap((observation): GroupPriceInterface[] => {
    const offer = offerOf(observation, marketplaces);
    const isNewest = newest.get(observation.trackedProductId) === observation;

    return offer === null || isNewest || observation.observedAt.getTime() < since ? [] : [offer];
  });
  const min = pick(earlier, (candidate, other): boolean => candidate < other);

  return {
    current,
    min,
    max: pick(earlier, (candidate, other): boolean => candidate > other),
    highlighted: current !== null && min !== null && current.amountMinor <= min.amountMinor,
  };
}
