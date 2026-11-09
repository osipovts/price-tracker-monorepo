import type { PrismaClient, Proxy as ProxyRow } from '../../generated/prisma/client.js';
import {
  type PageInterface,
  pageOffset,
  type PaginationInterface,
} from '../../shared/application/page.interface.js';
import type {
  ProxyFilterInterface,
  ProxyRepositoryPort,
  ProxySourceStatsInterface,
  StoredProxyStatsInterface,
} from '../application/proxy-repository.port.js';
import { manualProxySource, ProxyEntity } from '../domain/proxy.entity.js';

function toEntity(row: ProxyRow): ProxyEntity {
  return new ProxyEntity({
    server: row.server,
    source: row.source,
    country: row.country,
    exitIp: row.exitIp,
    alive: row.alive,
    latencyMs: row.latencyMs,
    checksTotal: row.checksTotal,
    checksAlive: row.checksAlive,
    lastCheckedAt: row.lastCheckedAt,
    lastSeenAt: row.lastSeenAt,
    disabledAt: row.disabledAt,
    credentials:
      row.username === null || row.password === null
        ? null
        : { username: row.username, password: row.password },
  });
}

export class PrismaProxyRepositoryAdapter implements ProxyRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findByServers(servers: string[]): Promise<ProxyEntity[]> {
    const rows = await this.prisma.proxy.findMany({ where: { server: { in: servers } } });

    return rows.map(toEntity);
  }

  async saveMany(proxies: ProxyEntity[]): Promise<void> {
    await this.prisma.$transaction(
      proxies.map((proxy) => {
        const { server, credentials, ...rest } = proxy.snapshot;
        const data = {
          ...rest,
          username: credentials?.username ?? null,
          password: credentials?.password ?? null,
          successRate: proxy.successRate,
        };

        return this.prisma.proxy.upsert({
          where: { server },
          create: { server, ...data },
          update: data,
        });
      }),
    );
  }

  async saveChecked(proxies: ProxyEntity[]): Promise<void> {
    await this.prisma.$transaction(
      proxies.map((proxy) => {
        const { server, credentials, disabledAt, ...rest } = proxy.snapshot;
        const data = { ...rest, successRate: proxy.successRate };

        return this.prisma.proxy.upsert({
          where: { server },
          create: {
            server,
            ...data,
            disabledAt,
            username: credentials?.username ?? null,
            password: credentials?.password ?? null,
          },
          // Not the time it was turned off nor the credentials: an administrator may have set them since the read.
          update: data,
        });
      }),
    );
  }

  async stats(): Promise<StoredProxyStatsInterface> {
    const [total, alive, disabled, aggregate] = await this.prisma.$transaction([
      this.prisma.proxy.count(),
      this.prisma.proxy.count({ where: { alive: true } }),
      this.prisma.proxy.count({ where: { disabledAt: { not: null } } }),
      this.prisma.proxy.aggregate({
        where: { alive: true },
        _avg: { latencyMs: true },
        _max: { lastCheckedAt: true },
      }),
    ]);
    const [sources, disabledSources] = await Promise.all([
      this.prisma.proxy.groupBy({ by: ['source', 'alive'], _count: { _all: true } }),
      this.prisma.proxy.groupBy({
        by: ['source'],
        where: { disabledAt: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const bySource = new Map<string, ProxySourceStatsInterface>();
    const ofSource = (source: string): ProxySourceStatsInterface => {
      const known = bySource.get(source) ?? { source, total: 0, alive: 0, disabled: 0 };
      bySource.set(source, known);

      return known;
    };
    for (const group of sources) {
      ofSource(group.source).total += group._count._all;
      if (group.alive) ofSource(group.source).alive += group._count._all;
    }
    for (const group of disabledSources) ofSource(group.source).disabled = group._count._all;
    const { _max: latest } = await this.prisma.proxy.aggregate({ _max: { lastCheckedAt: true } });
    const average = aggregate._avg.latencyMs;

    return {
      total,
      alive,
      disabled,
      averageLatencyMs: average === null ? null : Math.round(average),
      lastCheckedAt: latest.lastCheckedAt,
      bySource: [...bySource.values()].toSorted((a, b): number => a.source.localeCompare(b.source)),
    };
  }

  async listUnseen(since: Date, limit: number): Promise<ProxyEntity[]> {
    const rows = await this.prisma.proxy.findMany({
      where: { source: { not: manualProxySource }, lastSeenAt: { lt: since } },
      orderBy: [{ lastCheckedAt: 'asc' }, { server: 'asc' }],
      take: limit,
    });

    return rows.map(toEntity);
  }

  async deleteMany(servers: string[]): Promise<number> {
    const { count } = await this.prisma.proxy.deleteMany({ where: { server: { in: servers } } });

    return count;
  }

  async list(
    filter: ProxyFilterInterface,
    pagination: PaginationInterface,
  ): Promise<PageInterface<ProxyEntity>> {
    const where = {
      ...(filter.alive === undefined ? {} : { alive: filter.alive }),
      ...(filter.country === undefined ? {} : { country: filter.country }),
      ...(filter.disabled === undefined
        ? {}
        : { disabledAt: filter.disabled ? { not: null } : null }),
      ...(filter.manual === undefined
        ? {}
        : { source: filter.manual ? manualProxySource : { not: manualProxySource } }),
      ...(filter.source === undefined ? {} : { source: filter.source }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.proxy.findMany({
        where,
        orderBy: [
          { alive: 'desc' },
          { successRate: 'desc' },
          { latencyMs: { sort: 'asc', nulls: 'last' } },
          // Equals stay in one order: without it a row that was updated jumps among its equals.
          { server: 'asc' },
        ],
        skip: pageOffset(pagination),
        take: pagination.pageSize,
      }),
      this.prisma.proxy.count({ where }),
    ]);

    return { items: rows.map(toEntity), total };
  }
}
