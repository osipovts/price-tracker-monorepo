import type { MarketplaceType } from 'product-reference';
import type { HandbookCityType } from 'queue-contract';

import type { HandbookRepositoryPort } from './handbook-repository.port.js';
import { marketplaceCityHandbooks } from './marketplace-city-handbooks.type.js';
import { marketplaceStaticCities } from './marketplace-static-cities.type.js';

export class FindCityUseCase {
  constructor(private readonly handbooks: HandbookRepositoryPort) {}

  /** The city of the marketplace by the id it gives it, or by one of its aliases; null if it has none such. */
  async execute(marketplace: MarketplaceType, cityId: string): Promise<HandbookCityType | null> {
    const handbook = marketplaceCityHandbooks[marketplace];
    const cities =
      marketplaceStaticCities[marketplace] ??
      (handbook === undefined ? [] : ((await this.handbooks.findCities(handbook))?.cities ?? []));

    return (
      cities.find((city): boolean => city.id === cityId) ??
      cities.find((city): boolean => city.aliases?.includes(cityId) === true) ??
      null
    );
  }
}
