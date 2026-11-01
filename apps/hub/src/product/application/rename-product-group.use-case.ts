import { ProductGroupNotFoundError } from './product-group-not-found.error.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';

export class RenameProductGroupUseCase {
  constructor(private readonly groups: ProductGroupRepositoryPort) {}

  async execute(userId: string, groupId: string, title: string): Promise<void> {
    if (!(await this.groups.rename(userId, groupId, title))) {
      throw new ProductGroupNotFoundError(groupId);
    }
  }
}
