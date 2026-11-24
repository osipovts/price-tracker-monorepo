import type { operations } from '../../shared/api/schema.js';

export type CityMarketplaceType =
  operations['CitiesController_list']['parameters']['path']['marketplace'];

/** The hosts of the marketplaces whose prices depend on the city: the user is asked for one. */
const cityMarketplaceHostPatterns: ReadonlyArray<[CityMarketplaceType, RegExp]> = [
  ['ozon', /^(?:www\.)?ozon\.ru$/i],
  ['dns', /^(?:www\.)?dns-shop\.ru$/i],
  ['wildberries', /^(?:www\.)?(?:wildberries|wb)\.ru$/i],
  ['citilink', /^(?:www\.)?citilink\.ru$/i],
  ['sportmaster', /^(?:www\.)?sportmaster\.ru$/i],
  ['aliexpress', /^(?:www\.)?aliexpress\.ru$/i],
  ['apteka', /^(?:www\.)?apteka\.ru$/i],
  ['cifrus', /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)?cifrus\.ru$/i],
];

/** The marketplace of the link when its prices depend on the city; null for the others and for what is not a link. */
export function cityMarketplaceOf(link: string): CityMarketplaceType | null {
  try {
    const { hostname } = new URL(link);

    return (
      cityMarketplaceHostPatterns.find(([, pattern]): boolean => pattern.test(hostname))?.[0] ??
      null
    );
  } catch {
    return null;
  }
}
