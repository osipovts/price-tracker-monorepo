import { marketplaces, type MarketplaceType } from 'product-reference';
import { z } from 'zod';

import type {
  PrismaClient,
  TrackedProduct as TrackedProductRow,
} from '../../generated/prisma/client.js';
import {
  type PageInterface,
  pageOffset,
  type PaginationInterface,
} from '../../shared/application/page.interface.js';
import { ProductGoneError } from '../application/product-gone.error.js';
import type {
  TrackedProductReferenceInterface,
  TrackedProductRepositoryPort,
} from '../application/tracked-product-repository.port.js';
import { TrackedProductEntity } from '../domain/tracked-product.entity.js';

const marketplaceSchema = z.enum(marketplaces);

/** Prisma reports a violated foreign key as P2003. */
function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'P2003';
}

function toEntity(row: TrackedProductRow): TrackedProductEntity {
  return new TrackedProductEntity({
    id: row.id,
    marketplace: marketplaceSchema.parse(row.marketplace),
    externalId: row.externalId,
    url: row.url,
    cityId: row.cityId === '' ? null : row.cityId,
    cityName: row.cityName,
    lastStatus: row.lastStatus,
    lastCheckedAt: row.lastCheckedAt,
    lastRequestedAt: row.lastRequestedAt,
    thumbnailKey: row.thumbnailKey,
    thumbnailSourceUrl: row.thumbnailSourceUrl,
  });
}

export class PrismaTrackedProductRepositoryAdapter implements TrackedProductRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async add(
    reference: TrackedProductReferenceInterface,
  ): Promise<{ product: TrackedProductEntity; created: boolean }> {
    // Skipping a duplicate instead of reading first keeps concurrent adds of a product apart.
    const { count } = await this.prisma.trackedProduct.createMany({
      data: [{ ...reference, cityId: reference.cityId ?? '' }],
      skipDuplicates: true,
    });
    const row = await this.prisma.trackedProduct.findUniqueOrThrow({
      where: {
        marketplaceExternalIdCity: {
          marketplace: reference.marketplace,
          externalId: reference.externalId,
          cityId: reference.cityId ?? '',
        },
      },
    });

    return { product: toEntity(row), created: count > 0 };
  }

  async subscribe(userId: string, productId: string): Promise<boolean> {
    try {
      // Skipping a duplicate instead of reading first keeps concurrent subscriptions apart.
      const { count } = await this.prisma.productSubscription.createMany({
        data: [{ userId, trackedProductId: productId }],
        skipDuplicates: true,
      });

      return count > 0;
    } catch (error: unknown) {
      // The foreign key to the product: the last tracker removed it just now.
      if (isForeignKeyViolation(error)) throw new ProductGoneError(productId);

      throw error;
    }
  }

  unsubscribe(userId: string, productId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx): Promise<boolean> => {
      // The row is locked until the end: a user joining the product meanwhile waits, then either
      // finds it kept or fails its foreign key and adds the product anew.
      await tx.$queryRaw`SELECT id FROM tracked_products WHERE id = ${productId}::uuid FOR UPDATE`;

      const { count } = await tx.productSubscription.deleteMany({
        where: { userId, trackedProductId: productId },
      });
      if (count === 0) return false;

      await tx.trackedProduct.deleteMany({
        where: { id: productId, subscriptions: { none: {} } },
      });

      return true;
    });
  }

  async findInCities(
    marketplace: MarketplaceType,
    externalId: string,
    cityIds: ReadonlyArray<string | null>,
  ): Promise<TrackedProductEntity | null> {
    const row = await this.prisma.trackedProduct.findFirst({
      // A product without a city keeps an empty one.
      where: {
        marketplace,
        externalId,
        cityId: { in: cityIds.map((cityId): string => cityId ?? '') },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return row === null ? null : toEntity(row);
  }

  async findSubscribedByReference(
    userId: string,
    reference: TrackedProductReferenceInterface,
  ): Promise<TrackedProductEntity | null> {
    const row = await this.prisma.trackedProduct.findFirst({
      where: {
        marketplace: reference.marketplace,
        externalId: reference.externalId,
        cityId: reference.cityId ?? '',
        subscriptions: { some: { userId } },
      },
    });

    return row === null ? null : toEntity(row);
  }

  async listDueForRefresh(before: Date, limit: number): Promise<TrackedProductEntity[]> {
    const rows = await this.prisma.trackedProduct.findMany({
      where: {
        subscriptions: { some: {} },
        AND: [
          { OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: before } }] },
          { OR: [{ lastRequestedAt: null }, { lastRequestedAt: { lt: before } }] },
        ],
      },
      // The ones nothing has touched come first, then the longest waiting.
      orderBy: [
        { lastRequestedAt: { sort: 'asc', nulls: 'first' } },
        { lastCheckedAt: { sort: 'asc', nulls: 'first' } },
      ],
      take: limit,
    });

    return rows.map(toEntity);
  }

  async setThumbnail(id: string, key: string, sourceUrl: string): Promise<void> {
    await this.prisma.trackedProduct.updateMany({
      where: { id },
      data: { thumbnailKey: key, thumbnailSourceUrl: sourceUrl },
    });
  }

  async markRequested(productIds: string[], at: Date): Promise<void> {
    await this.prisma.trackedProduct.updateMany({
      where: { id: { in: productIds } },
      data: { lastRequestedAt: at },
    });
  }

  async stats(): Promise<{ products: number; trackings: number }> {
    const [products, trackings] = await this.prisma.$transaction([
      this.prisma.trackedProduct.count(),
      this.prisma.productSubscription.count(),
    ]);

    return { products, trackings };
  }

  async findSubscribed(userId: string, productId: string): Promise<TrackedProductEntity | null> {
    const row = await this.prisma.trackedProduct.findFirst({
      where: { id: productId, subscriptions: { some: { userId } } },
    });

    return row === null ? null : toEntity(row);
  }

  async listSubscribed(
    userId: string,
    pagination: PaginationInterface,
  ): Promise<PageInterface<TrackedProductEntity>> {
    const where = { userId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productSubscription.findMany({
        where,
        include: { trackedProduct: true },
        // The id settles products subscribed at the same moment: the pages must not repeat or skip one.
        orderBy: [{ createdAt: 'desc' }, { trackedProductId: 'asc' }],
        skip: pageOffset(pagination),
        take: pagination.pageSize,
      }),
      this.prisma.productSubscription.count({ where }),
    ]);

    return { items: rows.map((row): TrackedProductEntity => toEntity(row.trackedProduct)), total };
  }

  async findById(id: string): Promise<TrackedProductEntity | null> {
    const row = await this.prisma.trackedProduct.findUnique({ where: { id } });

    return row === null ? null : toEntity(row);
  }

  async markChecked(id: string, status: string, checkedAt: Date): Promise<void> {
    await this.prisma.trackedProduct.updateMany({
      where: { id },
      data: { lastStatus: status, lastCheckedAt: checkedAt },
    });
  }
}
