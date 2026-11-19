import type { MarketplaceType } from 'product-reference';

import type { DisabledMarketplaceRepositoryPort } from './disabled-marketplace-repository.port.js';

/** Turns link intake for a marketplace off or on; existing tracked products keep reading. */
export class SetMarketplaceDisabledUseCase {
  constructor(private readonly disabledMarketplaces: DisabledMarketplaceRepositoryPort) {}

  async execute(marketplace: MarketplaceType, disabled: boolean): Promise<void> {
    await this.disabledMarketplaces.setDisabled(marketplace, disabled);
  }
}
