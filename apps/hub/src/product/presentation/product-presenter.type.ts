import type { ProductGroupViewInterface } from '../application/describe-product-groups.use-case.js';
import { findLastGroupCheck } from '../application/group-checks.type.js';
import type { GroupPriceInterface } from '../application/group-price-summary.type.js';
import { nextPriceCheckAt } from '../application/next-price-check.type.js';
import type { PriceObservationInterface } from '../domain/price-observation.interface.js';
import type { TrackedProductEntity } from '../domain/tracked-product.entity.js';
import type { PriceObservationType } from './price-observation.type.js';
import type { ProductType } from './product.type.js';
import type { ProductGroupDetailType, ProductGroupType } from './product-group.type.js';

/** Where a browser loads a kept picture from; null for none. */
export type ThumbnailUrlType = (key: string | null) => Promise<string | null>;

export function toObservation(observation: PriceObservationInterface): PriceObservationType {
  return {
    id: observation.id,
    observedAt: observation.observedAt.toISOString(),
    title: observation.title,
    availability: observation.availability,
    prices: observation.prices,
    exitIp: observation.exitIp,
  };
}

export function toProduct(
  { snapshot }: TrackedProductEntity,
  thumbnailUrl: string | null,
  refreshAfterMs: number,
): ProductType {
  const next = nextPriceCheckAt(snapshot, refreshAfterMs, new Date());

  return {
    id: snapshot.id,
    marketplace: snapshot.marketplace,
    externalId: snapshot.externalId,
    url: snapshot.url,
    cityId: snapshot.cityId,
    cityName: snapshot.cityName,
    lastStatus: snapshot.lastStatus,
    lastCheckedAt: snapshot.lastCheckedAt?.toISOString() ?? null,
    nextCheckAt: next?.toISOString() ?? null,
    thumbnailUrl,
  };
}

function toPrice(
  price: GroupPriceInterface | null,
): { marketplace: string; amountMinor: number; observedAt: string } | null {
  return price === null
    ? null
    : {
        marketplace: price.marketplace,
        amountMinor: price.amountMinor,
        observedAt: price.observedAt.toISOString(),
      };
}

export async function toProductGroup(
  view: ProductGroupViewInterface,
  thumbnailUrl: ThumbnailUrlType,
): Promise<ProductGroupType> {
  const { group, prices } = view;
  const lastCheck = findLastGroupCheck(view.products.map(({ product }) => product.snapshot));

  return {
    id: group.snapshot.id,
    title: view.title,
    thumbnailUrl: await thumbnailUrl(view.thumbnailKey),
    createdAt: group.snapshot.createdAt.toISOString(),
    productCount: view.products.length,
    lastCheck:
      lastCheck === null
        ? null
        : { marketplace: lastCheck.marketplace, checkedAt: lastCheck.checkedAt.toISOString() },
    current: toPrice(prices.current),
    min: toPrice(prices.min),
    max: toPrice(prices.max),
    highlighted: prices.highlighted,
  };
}

/** A group with its products, each with its newest price. */
export async function toProductGroupDetail(
  view: ProductGroupViewInterface,
  thumbnailUrl: ThumbnailUrlType,
  refreshAfterMs: number,
): Promise<ProductGroupDetailType> {
  return {
    ...(await toProductGroup(view, thumbnailUrl)),
    statsPeriod: view.statsPeriod,
    products: await Promise.all(
      view.products.map(async ({ product, latest }) => ({
        ...toProduct(product, await thumbnailUrl(product.snapshot.thumbnailKey), refreshAfterMs),
        latest: latest === null ? null : toObservation(latest),
      })),
    ),
  };
}
