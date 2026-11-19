import type { MarketplaceType } from 'product-reference';

export const DISABLED_MARKETPLACE_REPOSITORY = Symbol('DISABLED_MARKETPLACE_REPOSITORY');

/** Marketplaces whose link intake an administrator has turned off. */
export interface DisabledMarketplaceRepositoryPort {
  isDisabled(marketplace: MarketplaceType): Promise<boolean>;
  listDisabled(): Promise<MarketplaceType[]>;
  setDisabled(marketplace: MarketplaceType, disabled: boolean): Promise<void>;
}

/** Default for tests that do not exercise marketplace toggles. */
export const allMarketplacesEnabled: Pick<
  DisabledMarketplaceRepositoryPort,
  'isDisabled' | 'listDisabled'
> = {
  isDisabled: (): Promise<boolean> => Promise.resolve(false),
  listDisabled: (): Promise<MarketplaceType[]> => Promise.resolve([]),
};
