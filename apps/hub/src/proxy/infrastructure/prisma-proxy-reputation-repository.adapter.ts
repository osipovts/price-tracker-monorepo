import { marketplaces, type MarketplaceType } from 'product-reference';
import { z } from 'zod';

import type {
  PrismaClient,
  ProxyReputation as ProxyReputationRow,
} from '../../generated/prisma/client.js';
import type { ProxyReputationRepositoryPort } from '../application/proxy-reputation-repository.port.js';
import { proxyOutcomes, ProxyReputationEntity } from '../domain/proxy-reputation.entity.js';

const marketplaceSchema = z.enum(marketplaces);

const outcomeSchema = z.enum(proxyOutcomes);

function toEntity(row: ProxyReputationRow): ProxyReputationEntity {
  return new ProxyReputationEntity({
    server: row.server,
    marketplace: marketplaceSchema.parse(row.marketplace),
    successes: row.successes,
    failures: row.failures,
    failureStreak: row.failureStreak,
    lastOutcome: outcomeSchema.parse(row.lastOutcome),
    lastAttemptAt: row.lastAttemptAt,
    cooldownUntil: row.cooldownUntil,
  });
}

export class PrismaProxyReputationRepositoryAdapter implements ProxyReputationRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findByServers(
    servers: string[],
    marketplace?: MarketplaceType,
  ): Promise<ProxyReputationEntity[]> {
    const rows = await this.prisma.proxyReputation.findMany({
      where: { server: { in: servers }, ...(marketplace === undefined ? {} : { marketplace }) },
    });

    return rows.map(toEntity);
  }

  async saveMany(reputations: ProxyReputationEntity[]): Promise<void> {
    await this.prisma.$transaction(
      reputations.map(({ snapshot }) => {
        const { server, marketplace, ...data } = snapshot;

        return this.prisma.proxyReputation.upsert({
          where: { server_marketplace: { server, marketplace } },
          create: { server, marketplace, ...data },
          update: data,
        });
      }),
    );
  }
}
