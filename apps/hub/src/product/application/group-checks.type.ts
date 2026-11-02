import type { MarketplaceType } from 'product-reference';

import type { TrackedProductInterface } from '../domain/tracked-product.entity.js';

export interface GroupCheckInterface {
  marketplace: MarketplaceType;
  checkedAt: Date;
}

/** The newest read of the prices of a group, with the marketplace it was on; null while none was read. */
export function findLastGroupCheck(
  products: ReadonlyArray<Pick<TrackedProductInterface, 'marketplace' | 'lastCheckedAt'>>,
): GroupCheckInterface | null {
  let last: GroupCheckInterface | null = null;
  for (const { marketplace, lastCheckedAt } of products) {
    if (lastCheckedAt !== null && (last === null || lastCheckedAt > last.checkedAt)) {
      last = { marketplace, checkedAt: lastCheckedAt };
    }
  }

  return last;
}
