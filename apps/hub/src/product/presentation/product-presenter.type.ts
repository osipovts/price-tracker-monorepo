import { nextPriceCheckAt } from '../application/next-price-check.type.js';
import type { PriceObservationInterface } from '../domain/price-observation.interface.js';
import type { TrackedProductEntity } from '../domain/tracked-product.entity.js';
import type { PriceObservationType } from './price-observation.type.js';
import type { ProductType } from './product.type.js';

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
