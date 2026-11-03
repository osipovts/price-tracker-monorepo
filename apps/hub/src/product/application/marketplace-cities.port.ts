import type { MarketplaceCityInterface, MarketplaceType } from 'product-reference';

/** A city the hub knows of a marketplace, by the id the handbook gives it now. */
export interface KnownCityInterface extends MarketplaceCityInterface {
  /** The other ids the city is known by: a product may be tracked in it by any of them. */
  aliases: readonly string[];
}

export interface MarketplaceCitiesPort {
  /** The city of the marketplace by the id it gives it, or by one of its aliases; null if it has none such. */
  find(marketplace: MarketplaceType, cityId: string): Promise<KnownCityInterface | null>;
}
