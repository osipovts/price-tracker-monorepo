import type {
  PageInterface,
  PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { PriceObservationInterface } from '../domain/price-observation.interface.js';
import type { TrackedProductEntity } from '../domain/tracked-product.entity.js';
import type { PriceObservationRepositoryPort } from './price-observation-repository.port.js';
import { ProductNotFoundError } from './product-not-found.error.js';
import { administratorViewer, type ProductViewerType } from './product-viewer.type.js';
import type { TrackedProductRepositoryPort } from './tracked-product-repository.port.js';

export class ListPriceHistoryUseCase {
  constructor(
    private readonly products: TrackedProductRepositoryPort,
    private readonly observations: PriceObservationRepositoryPort,
  ) {}

  /** The history of a product the user tracks; to any other user the product does not exist. */
  async execute(
    viewer: ProductViewerType,
    productId: string,
    pagination: PaginationInterface,
  ): Promise<{ product: TrackedProductEntity; page: PageInterface<PriceObservationInterface> }> {
    const product =
      viewer === administratorViewer
        ? await this.products.findById(productId)
        : await this.products.findSubscribed(viewer, productId);
    if (product === null) throw new ProductNotFoundError(productId);

    return { product, page: await this.observations.listByProduct(productId, pagination) };
  }
}
