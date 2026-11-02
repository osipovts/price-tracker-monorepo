import { ProductGroupNotFoundError } from './product-group-not-found.error.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';
import type { RemoveProductUseCase } from './remove-product.use-case.js';

/** Deletes a group, and stops tracking its products as when the user removes them one by one. */
export class RemoveProductGroupUseCase {
  constructor(
    private readonly groups: ProductGroupRepositoryPort,
    private readonly removeProduct: Pick<RemoveProductUseCase, 'execute'>,
  ) {}

  async execute(userId: string, groupId: string): Promise<void> {
    if ((await this.groups.findOwned(userId, groupId)) === null) {
      throw new ProductGroupNotFoundError(groupId);
    }

    for (const { productId } of await this.groups.listProductIds([groupId])) {
      await this.removeProduct.execute(userId, productId);
    }

    await this.groups.delete(userId, groupId);
  }
}
