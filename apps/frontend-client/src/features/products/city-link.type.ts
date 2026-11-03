import type { operations } from '../../shared/api/schema.js';

export type CityMarketplaceType =
  operations['CitiesController_list']['parameters']['path']['marketplace'];

/** The hosts of the marketplaces whose prices depend on the city: the user is asked for one. */
const cityMarketplaceHosts: ReadonlyArray<[CityMarketplaceType, readonly string[]]> = [
  ['dns', ['dns-shop.ru', 'www.dns-shop.ru']],
  ['wildberries', ['wildberries.ru', 'www.wildberries.ru', 'wb.ru', 'www.wb.ru']],
];

/** The marketplace of the link when its prices depend on the city; null for the others and for what is not a link. */
export function cityMarketplaceOf(link: string): CityMarketplaceType | null {
  try {
    const { hostname } = new URL(link);

    return cityMarketplaceHosts.find(([, hosts]): boolean => hosts.includes(hostname))?.[0] ?? null;
  } catch {
    return null;
  }
}
