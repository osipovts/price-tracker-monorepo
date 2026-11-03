export const marketplaces = ['ozon', 'dns', 'wildberries'] as const;

export type MarketplaceType = (typeof marketplaces)[number];

/** A marketplace serves its prices to visitors from this country only (ISO 3166-1 alpha-2). */
export const marketplaceExitCountries: Readonly<Record<MarketplaceType, string>> = {
  ozon: 'RU',
  dns: 'RU',
  wildberries: 'RU',
};

export interface MarketplaceCityInterface {
  /** The id the marketplace gives the city. */
  id: string;
  name: string;
}

/**
 * The city a marketplace whose prices depend on it falls back to. A marketplace that is not here has
 * one price for everyone and no city.
 */
export const marketplaceDefaultCities: Readonly<
  Partial<Record<MarketplaceType, MarketplaceCityInterface>>
> = {
  dns: { id: '30b7c1f3-03fb-11dc-95ee-00151716f9f5', name: 'Москва' },
};
