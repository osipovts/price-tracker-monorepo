import type { MarketplaceType } from 'product-reference';

import {
  ApplicationError,
  type ApplicationErrorKindType,
} from '../../shared/application/application.error.js';

export class MarketplaceDisabledError extends ApplicationError {
  readonly kind: ApplicationErrorKindType = 'forbidden';

  constructor(marketplace: MarketplaceType) {
    super(`Adding links from ${marketplace} is disabled`);
  }
}
