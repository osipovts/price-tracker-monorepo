import type {
  PageInterface,
  PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { ProductGroupEntity } from '../domain/product-group.entity.js';

export const PRODUCT_GROUP_REPOSITORY = Symbol('ProductGroupRepositoryPort');

export interface ProductGroupRepositoryPort {
  create(userId: string, title: string | null): Promise<ProductGroupEntity>;
  /** The group, if the user owns it. */
  findOwned(userId: string, groupId: string): Promise<ProductGroupEntity | null>;
  /** The group whoever owns it: for an administrator, never for a user. */
  findById(groupId: string): Promise<ProductGroupEntity | null>;
  /** The groups of every user, the newest first: for an administrator, never for a user. */
  listAll(pagination: PaginationInterface): Promise<PageInterface<ProductGroupEntity>>;
  /** The groups of the user, the newest first. */
  listOwned(
    userId: string,
    pagination: PaginationInterface,
  ): Promise<PageInterface<ProductGroupEntity>>;
  /** False if the user owns no such group. */
  rename(userId: string, groupId: string, title: string): Promise<boolean>;
  /** Deletes the group and what it holds of the tracking; false if the user owns no such group. */
  delete(userId: string, groupId: string): Promise<boolean>;
  /** The products the user tracks go into the group; one already in a group of the user stays where it is. */
  place(userId: string, groupId: string, productId: string): Promise<void>;
  /** The group of the user that holds the product. */
  findGroupIdOfProduct(userId: string, productId: string): Promise<string | null>;
  /** The product ids of each of the groups, in the order they were added. */
  listProductIds(
    groupIds: readonly string[],
  ): Promise<Array<{ groupId: string; productId: string }>>;
}
