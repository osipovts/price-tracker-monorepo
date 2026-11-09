import {
  type PageInterface,
  pageOf,
  type PaginationInterface,
} from '../../shared/application/page.interface.js';
import type {
  ProxyFilterInterface,
  ProxyRepositoryPort,
  ProxySourceStatsInterface,
  StoredProxyStatsInterface,
} from '../application/proxy-repository.port.js';
import { ProxyEntity } from '../domain/proxy.entity.js';

function matches(proxy: ProxyEntity, filter: ProxyFilterInterface): boolean {
  const { snapshot } = proxy;

  return (
    (filter.manual === undefined || proxy.isManual === filter.manual) &&
    (filter.source === undefined || snapshot.source === filter.source) &&
    (filter.alive === undefined || snapshot.alive === filter.alive) &&
    (filter.country === undefined || snapshot.country === filter.country) &&
    (filter.disabled === undefined || (snapshot.disabledAt !== null) === filter.disabled)
  );
}

/** The best first: alive ones, then the most reliable, then the fastest, then by address. */
function byQuality(a: ProxyEntity, b: ProxyEntity): number {
  return (
    Number(b.snapshot.alive) - Number(a.snapshot.alive) ||
    b.successRate - a.successRate ||
    (a.snapshot.latencyMs ?? Infinity) - (b.snapshot.latencyMs ?? Infinity) ||
    a.snapshot.server.localeCompare(b.snapshot.server)
  );
}

export class InMemoryProxyRepositoryAdapter implements ProxyRepositoryPort {
  private readonly proxies = new Map<string, ProxyEntity>();

  findByServers(servers: string[]): Promise<ProxyEntity[]> {
    return Promise.resolve(
      servers.flatMap((server): ProxyEntity[] => {
        const proxy = this.proxies.get(server);

        return proxy === undefined ? [] : [proxy];
      }),
    );
  }

  saveMany(proxies: ProxyEntity[]): Promise<void> {
    for (const proxy of proxies) this.proxies.set(proxy.snapshot.server, proxy);

    return Promise.resolve();
  }

  saveChecked(proxies: ProxyEntity[]): Promise<void> {
    for (const proxy of proxies) {
      const stored = this.proxies.get(proxy.snapshot.server)?.snapshot;
      this.proxies.set(
        proxy.snapshot.server,
        stored === undefined
          ? proxy
          : new ProxyEntity({
              ...proxy.snapshot,
              disabledAt: stored.disabledAt,
              credentials: stored.credentials,
            }),
      );
    }

    return Promise.resolve();
  }

  stats(): Promise<StoredProxyStatsInterface> {
    const all = Array.from(this.proxies.values()).map(({ snapshot }) => snapshot);
    const sources = [...new Set(all.map((proxy): string => proxy.source))].toSorted();
    const latencies = all
      .filter((proxy): boolean => proxy.alive && proxy.latencyMs !== null)
      .map((proxy): number => proxy.latencyMs ?? 0);

    return Promise.resolve({
      total: all.length,
      alive: all.filter((proxy): boolean => proxy.alive).length,
      disabled: all.filter((proxy): boolean => proxy.disabledAt !== null).length,
      averageLatencyMs:
        latencies.length === 0
          ? null
          : Math.round(latencies.reduce((sum, value): number => sum + value, 0) / latencies.length),
      lastCheckedAt:
        all.length === 0
          ? null
          : new Date(Math.max(...all.map((proxy): number => proxy.lastCheckedAt.getTime()))),
      bySource: sources.map((source): ProxySourceStatsInterface => {
        const own = all.filter((proxy): boolean => proxy.source === source);

        return {
          source,
          total: own.length,
          alive: own.filter((proxy): boolean => proxy.alive).length,
          disabled: own.filter((proxy): boolean => proxy.disabledAt !== null).length,
        };
      }),
    });
  }

  listUnseen(since: Date, limit: number): Promise<ProxyEntity[]> {
    return Promise.resolve(
      Array.from(this.proxies.values())
        .filter((proxy): boolean => !proxy.isManual && proxy.snapshot.lastSeenAt < since)
        .toSorted(
          (a, b): number => a.snapshot.lastCheckedAt.getTime() - b.snapshot.lastCheckedAt.getTime(),
        )
        .slice(0, limit),
    );
  }

  deleteMany(servers: string[]): Promise<number> {
    return Promise.resolve(servers.filter((server): boolean => this.proxies.delete(server)).length);
  }

  list(
    filter: ProxyFilterInterface,
    pagination: PaginationInterface,
  ): Promise<PageInterface<ProxyEntity>> {
    const matching = Array.from(this.proxies.values())
      .filter((proxy): boolean => matches(proxy, filter))
      .toSorted(byQuality);

    return Promise.resolve(pageOf(matching, pagination));
  }
}
