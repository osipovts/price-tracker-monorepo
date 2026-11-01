import { z } from 'zod';

import type {
  PriceObservation as PriceObservationRow,
  PrismaClient,
} from '../../generated/prisma/client.js';
import {
  type PageInterface,
  pageOffset,
  type PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { PriceObservationRepositoryPort } from '../application/price-observation-repository.port.js';
import {
  availabilities,
  type PriceObservationInterface,
} from '../domain/price-observation.interface.js';

const pricesSchema = z.array(
  z.object({
    amountMinor: z.number().int(),
    currency: z.literal('RUB'),
  }),
);
const availabilitySchema = z.enum(availabilities);

function toObservation(row: PriceObservationRow): PriceObservationInterface {
  return {
    id: row.id,
    trackedProductId: row.trackedProductId,
    jobId: row.jobId,
    title: row.title,
    observedAt: row.observedAt,
    availability: availabilitySchema.parse(row.availability),
    prices: pricesSchema.parse(row.prices),
    exitIp: row.exitIp,
  };
}

export class PrismaPriceObservationRepositoryAdapter implements PriceObservationRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async saveIfAbsent(observation: PriceObservationInterface): Promise<void> {
    await this.prisma.priceObservation.createMany({
      data: [
        {
          id: observation.id,
          trackedProductId: observation.trackedProductId,
          jobId: observation.jobId,
          title: observation.title,
          observedAt: observation.observedAt,
          availability: observation.availability,
          prices: observation.prices.map((price) => ({
            amountMinor: price.amountMinor,
            currency: price.currency,
          })),
          exitIp: observation.exitIp,
        },
      ],
      skipDuplicates: true,
    });
  }

  async findLatestByProducts(
    trackedProductIds: readonly string[],
  ): Promise<PriceObservationInterface[]> {
    const rows = await this.prisma.priceObservation.findMany({
      where: { trackedProductId: { in: [...trackedProductIds] } },
      orderBy: [{ trackedProductId: 'asc' }, { observedAt: 'desc' }],
      distinct: ['trackedProductId'],
    });

    return rows.map(toObservation);
  }

  async listSince(
    trackedProductIds: readonly string[],
    since: Date,
  ): Promise<PriceObservationInterface[]> {
    const rows = await this.prisma.priceObservation.findMany({
      where: { trackedProductId: { in: [...trackedProductIds] }, observedAt: { gte: since } },
      orderBy: { observedAt: 'asc' },
    });

    return rows.map(toObservation);
  }

  async listByProduct(
    trackedProductId: string,
    pagination: PaginationInterface,
  ): Promise<PageInterface<PriceObservationInterface>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.priceObservation.findMany({
        where: { trackedProductId },
        orderBy: { observedAt: 'desc' },
        skip: pageOffset(pagination),
        take: pagination.pageSize,
      }),
      this.prisma.priceObservation.count({ where: { trackedProductId } }),
    ]);

    return { items: rows.map(toObservation), total };
  }
}
