import type { MarketplaceType } from 'product-reference';

import type { PriceObservationRepositoryPort } from './price-observation-repository.port.js';
import type { TrackedProductRepositoryPort } from './tracked-product-repository.port.js';

export interface ProductDescriptionInterface {
  id: string;
  marketplace: MarketplaceType;
  url: string;
  /** The name of the city whose price is read; null where the marketplace has no cities. */
  cityName: string | null;
  /** The title of the newest read; null until the first one. */
  title: string | null;
}

/** The form of the ids of the products: anything else names none, and is not looked up. */
const productIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Names the products by their ids, for an administrator; an id of no product is left out. */
export class DescribeProductsUseCase {
  constructor(
    private readonly products: TrackedProductRepositoryPort,
    private readonly observations: PriceObservationRepositoryPort,
  ) {}

  async execute(productIds: readonly string[]): Promise<ProductDescriptionInterface[]> {
    const ids = [...new Set(productIds)].filter((id): boolean => productIdPattern.test(id));
    const [found, latest] = await Promise.all([
      Promise.all(ids.map((id) => this.products.findById(id))),
      this.observations.findLatestByProducts(ids),
    ]);

    return found.flatMap((product): ProductDescriptionInterface[] => {
      if (product === null) return [];

      const { id, marketplace, url, cityName } = product.snapshot;
      const title = latest.find(({ trackedProductId }): boolean => trackedProductId === id)?.title;

      return [{ id, marketplace, url, cityName, title: title ?? null }];
    });
  }
}
