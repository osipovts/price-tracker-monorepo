import type { MarketplaceType } from 'product-reference';
import type { HandbookType } from 'queue-contract';

/** The handbook that has the cities of a marketplace; one that is not here has no cities. */
export const marketplaceCityHandbooks: Readonly<Partial<Record<MarketplaceType, HandbookType>>> = {
  aliexpress: 'aliexpress-cities',
  apteka: 'apteka-cities',
  cifrus: 'cifrus-cities',
  dns: 'dns-cities',
  sportmaster: 'sportmaster-cities',
  wildberries: 'wildberries-cities',
};
