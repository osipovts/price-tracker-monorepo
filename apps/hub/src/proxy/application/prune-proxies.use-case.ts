import { type LoggerPort, silentLogger } from 'logger';

import { proxyUnseenLimitMs } from '../domain/proxy.entity.js';
import type { ProxyRepositoryPort } from './proxy-repository.port.js';

/** The most proxies one pass looks at; the rest wait for the next. */
const batchSize = 5000;

/** Drops the found proxies that are dead, failed many checks, and are out of the lists for long. */
export class PruneProxiesUseCase {
  constructor(
    private readonly proxies: ProxyRepositoryPort,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  async execute(now: Date): Promise<number> {
    const unseen = await this.proxies.listUnseen(
      new Date(now.getTime() - proxyUnseenLimitMs),
      batchSize,
    );
    const expired = unseen.filter((proxy): boolean => proxy.isExpired(now));
    if (expired.length === 0) return 0;

    const deleted = await this.proxies.deleteMany(
      expired.map((proxy): string => proxy.snapshot.server),
    );
    this.logger.info(`Dropped ${String(deleted)} dead proxies that no list names`);

    return deleted;
  }
}
