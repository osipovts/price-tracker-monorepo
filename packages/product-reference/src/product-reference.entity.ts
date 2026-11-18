import type { MarketplaceType } from './marketplace.type.js';

export class ProductReferenceEntity {
  constructor(
    readonly marketplace: MarketplaceType,
    readonly id: string,
    readonly url: string,
    /** The city whose price is read, by the id the marketplace gives it; null where it has no cities. */
    readonly cityId: string | null = null,
    readonly cityName: string | null = null,
  ) {}

  inCity(cityId: string | null, cityName: string | null = null): ProductReferenceEntity {
    return new ProductReferenceEntity(this.marketplace, this.id, this.url, cityId, cityName);
  }
}
