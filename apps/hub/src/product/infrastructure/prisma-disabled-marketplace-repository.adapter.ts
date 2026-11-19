import { marketplaces, type MarketplaceType } from 'product-reference';
import { z } from 'zod';

import type { PrismaClient } from '../../generated/prisma/client.js';
import type { DisabledMarketplaceRepositoryPort } from '../application/disabled-marketplace-repository.port.js';

const marketplaceSchema = z.enum(marketplaces);

export class PrismaDisabledMarketplaceRepositoryAdapter implements DisabledMarketplaceRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async isDisabled(marketplace: MarketplaceType): Promise<boolean> {
    const row = await this.prisma.disabledMarketplace.findUnique({
      where: { marketplace },
      select: { marketplace: true },
    });

    return row !== null;
  }

  async listDisabled(): Promise<MarketplaceType[]> {
    const rows = await this.prisma.disabledMarketplace.findMany({
      select: { marketplace: true },
    });

    return rows.flatMap(({ marketplace }): MarketplaceType[] => {
      const parsed = marketplaceSchema.safeParse(marketplace);

      return parsed.success ? [parsed.data] : [];
    });
  }

  async setDisabled(marketplace: MarketplaceType, disabled: boolean): Promise<void> {
    if (disabled) {
      await this.prisma.disabledMarketplace.upsert({
        where: { marketplace },
        create: { marketplace },
        update: {},
      });

      return;
    }

    await this.prisma.disabledMarketplace.deleteMany({ where: { marketplace } });
  }
}
