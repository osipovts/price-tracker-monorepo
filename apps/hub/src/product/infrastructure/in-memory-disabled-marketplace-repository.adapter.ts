import type { MarketplaceType } from 'product-reference';

import type { DisabledMarketplaceRepositoryPort } from '../application/disabled-marketplace-repository.port.js';

export class InMemoryDisabledMarketplaceRepositoryAdapter implements DisabledMarketplaceRepositoryPort {
  private readonly disabled = new Set<MarketplaceType>();

  isDisabled(marketplace: MarketplaceType): Promise<boolean> {
    return Promise.resolve(this.disabled.has(marketplace));
  }

  listDisabled(): Promise<MarketplaceType[]> {
    return Promise.resolve([...this.disabled]);
  }

  setDisabled(marketplace: MarketplaceType, disabled: boolean): Promise<void> {
    if (disabled) this.disabled.add(marketplace);
    else this.disabled.delete(marketplace);

    return Promise.resolve();
  }
}
