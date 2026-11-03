import { type MarketplaceType, ozonCities } from 'product-reference';
import type { HandbookCityType } from 'queue-contract';

/** The cities of a marketplace that has no list of its own: the hub knows them without a read. */
export const marketplaceStaticCities: Readonly<
  Partial<Record<MarketplaceType, readonly HandbookCityType[]>>
> = {
  ozon: ozonCities.map(({ id, name, region }): HandbookCityType => ({ id, name, region })),
};
