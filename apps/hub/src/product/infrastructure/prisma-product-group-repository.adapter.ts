import type {
  PrismaClient,
  ProductGroup as ProductGroupRow,
} from '../../generated/prisma/client.js';
import {
  type PageInterface,
  pageOffset,
  type PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { ProductGroupRepositoryPort } from '../application/product-group-repository.port.js';
import { ProductGroupEntity } from '../domain/product-group.entity.js';

function toEntity(row: ProductGroupRow): ProductGroupEntity {
  return new ProductGroupEntity({
    id: row.id,
    userId: row.userId,
    title: row.title,
    createdAt: row.createdAt,
  });
}

export class PrismaProductGroupRepositoryAdapter implements ProductGroupRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, title: string | null): Promise<ProductGroupEntity> {
    return toEntity(await this.prisma.productGroup.create({ data: { userId, title } }));
  }

  async findOwned(userId: string, groupId: string): Promise<ProductGroupEntity | null> {
    const row = await this.prisma.productGroup.findFirst({ where: { id: groupId, userId } });

    return row === null ? null : toEntity(row);
  }

  async findById(groupId: string): Promise<ProductGroupEntity | null> {
    const row = await this.prisma.productGroup.findUnique({ where: { id: groupId } });

    return row === null ? null : toEntity(row);
  }

  listAll(pagination: PaginationInterface): Promise<PageInterface<ProductGroupEntity>> {
    return this.listWhere({}, pagination);
  }

  listOwned(
    userId: string,
    pagination: PaginationInterface,
  ): Promise<PageInterface<ProductGroupEntity>> {
    return this.listWhere({ userId }, pagination);
  }

  private async listWhere(
    where: { userId?: string },
    pagination: PaginationInterface,
  ): Promise<PageInterface<ProductGroupEntity>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productGroup.findMany({
        where,
        // The id settles groups made at the same moment: the pages must not repeat or skip one.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: pageOffset(pagination),
        take: pagination.pageSize,
      }),
      this.prisma.productGroup.count({ where }),
    ]);

    return { items: rows.map(toEntity), total };
  }

  async rename(userId: string, groupId: string, title: string): Promise<boolean> {
    const { count } = await this.prisma.productGroup.updateMany({
      where: { id: groupId, userId },
      data: { title },
    });

    return count > 0;
  }

  async delete(userId: string, groupId: string): Promise<boolean> {
    const { count } = await this.prisma.productGroup.deleteMany({ where: { id: groupId, userId } });

    return count > 0;
  }

  async place(userId: string, groupId: string, productId: string): Promise<void> {
    // Skipping a duplicate keeps a product that is in a group in it.
    await this.prisma.productGroupItem.createMany({
      data: [{ userId, groupId, trackedProductId: productId }],
      skipDuplicates: true,
    });
  }

  async findGroupIdOfProduct(userId: string, productId: string): Promise<string | null> {
    const row = await this.prisma.productGroupItem.findUnique({
      where: { userId_trackedProductId: { userId, trackedProductId: productId } },
    });

    return row?.groupId ?? null;
  }

  async listProductIds(
    groupIds: readonly string[],
  ): Promise<Array<{ groupId: string; productId: string }>> {
    const rows = await this.prisma.productGroupItem.findMany({
      where: { groupId: { in: [...groupIds] } },
      orderBy: [{ createdAt: 'asc' }, { trackedProductId: 'asc' }],
    });

    return rows.map(({ groupId, trackedProductId }): { groupId: string; productId: string } => ({
      groupId,
      productId: trackedProductId,
    }));
  }
}
