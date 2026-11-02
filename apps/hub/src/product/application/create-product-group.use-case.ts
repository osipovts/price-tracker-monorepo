import type { ProductGroupEntity } from '../domain/product-group.entity.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';

/** An empty group the user fills with products later; one made with a product is made by adding it. */
export class CreateProductGroupUseCase {
  constructor(private readonly groups: ProductGroupRepositoryPort) {}

  execute(userId: string, title: string | null): Promise<ProductGroupEntity> {
    return this.groups.create(userId, title);
  }
}
