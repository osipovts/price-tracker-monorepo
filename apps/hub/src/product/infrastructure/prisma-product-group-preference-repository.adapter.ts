import { z } from 'zod';

import type { PrismaClient } from '../../generated/prisma/client.js';
import type { ProductGroupPreferenceRepositoryPort } from '../application/product-group-preference-repository.port.js';
import {
  defaultStatsPeriod,
  statsPeriods,
  type StatsPeriodType,
} from '../domain/stats-period.type.js';

const statsPeriodSchema = z.enum(statsPeriods);

export class PrismaProductGroupPreferenceRepositoryAdapter implements ProductGroupPreferenceRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async getStatsPeriod(userId: string): Promise<StatsPeriodType> {
    const row = await this.prisma.productGroupPreference.findUnique({ where: { userId } });

    return row === null ? defaultStatsPeriod : statsPeriodSchema.parse(row.statsPeriod);
  }

  async setStatsPeriod(userId: string, period: StatsPeriodType): Promise<void> {
    await this.prisma.productGroupPreference.upsert({
      where: { userId },
      create: { userId, statsPeriod: period },
      update: { statsPeriod: period },
    });
  }
}
