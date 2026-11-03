export const marketplaces = ['ozon', 'dns', 'wildberries', 'citilink'] as const;

export type MarketplaceType = (typeof marketplaces)[number];

/** A marketplace serves its prices to visitors from this country only (ISO 3166-1 alpha-2). */
export const marketplaceExitCountries: Readonly<Record<MarketplaceType, string>> = {
  ozon: 'RU',
  dns: 'RU',
  wildberries: 'RU',
  citilink: 'RU',
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
  // The region (`dest`) most of the pickup points of Moscow have: the prices are the same for all of them.
  wildberries: { id: '-1257403', name: 'Москва' },
  // A city of the static list of Ozon (see `ozonCities`).
  ozon: { id: 'moskva', name: 'Москва' },
  // A city of the static list of Citilink (see `citilinkCities`).
  citilink: { id: 'msk_cl', name: 'Москва' },
};
