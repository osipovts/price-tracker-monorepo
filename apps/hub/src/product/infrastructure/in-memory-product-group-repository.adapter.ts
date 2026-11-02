import { randomUUID } from 'node:crypto';

import {
  type PageInterface,
  pageOf,
  type PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { ProductGroupRepositoryPort } from '../application/product-group-repository.port.js';
import { ProductGroupEntity } from '../domain/product-group.entity.js';

export class InMemoryProductGroupRepositoryAdapter implements ProductGroupRepositoryPort {
  private groups: ProductGroupEntity[] = [];
  /** In the order of adding. */
  private items: Array<{ userId: string; groupId: string; productId: string }> = [];

  create(userId: string, title: string | null): Promise<ProductGroupEntity> {
    const group = new ProductGroupEntity({
      id: randomUUID(),
      userId,
      title,
      createdAt: new Date(),
    });
    this.groups.push(group);

    return Promise.resolve(group);
  }

  findOwned(userId: string, groupId: string): Promise<ProductGroupEntity | null> {
    return Promise.resolve(
      this.groups.find(
        ({ snapshot }): boolean => snapshot.id === groupId && snapshot.userId === userId,
      ) ?? null,
    );
  }

  listOwned(
    userId: string,
    pagination: PaginationInterface,
  ): Promise<PageInterface<ProductGroupEntity>> {
    const own = this.groups.filter(({ snapshot }): boolean => snapshot.userId === userId);

    return Promise.resolve(pageOf(own.toReversed(), pagination));
  }

  async rename(userId: string, groupId: string, title: string): Promise<boolean> {
    const group = await this.findOwned(userId, groupId);
    if (group === null) return false;

    this.groups = this.groups.map((other): ProductGroupEntity =>
      other === group ? new ProductGroupEntity({ ...group.snapshot, title }) : other,
    );

    return true;
  }

  async delete(userId: string, groupId: string): Promise<boolean> {
    if ((await this.findOwned(userId, groupId)) === null) return false;

    this.groups = this.groups.filter(({ snapshot }): boolean => snapshot.id !== groupId);
    this.items = this.items.filter((item): boolean => item.groupId !== groupId);

    return true;
  }

  place(userId: string, groupId: string, productId: string): Promise<void> {
    if (
      !this.items.some((item): boolean => item.userId === userId && item.productId === productId)
    ) {
      this.items.push({ userId, groupId, productId });
    }

    return Promise.resolve();
  }

  findGroupIdOfProduct(userId: string, productId: string): Promise<string | null> {
    return Promise.resolve(
      this.items.find((item): boolean => item.userId === userId && item.productId === productId)
        ?.groupId ?? null,
    );
  }

  listProductIds(
    groupIds: readonly string[],
  ): Promise<Array<{ groupId: string; productId: string }>> {
    return Promise.resolve(
      this.items
        .filter((item): boolean => groupIds.includes(item.groupId))
        .map(({ groupId, productId }): { groupId: string; productId: string } => ({
          groupId,
          productId,
        })),
    );
  }
}
