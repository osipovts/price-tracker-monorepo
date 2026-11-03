import { type LoggerPort, silentLogger } from 'logger';

import type { ProxyAttemptInterface } from '../domain/proxy-attempt.interface.js';
import { ProxyReputationEntity } from '../domain/proxy-reputation.entity.js';
import type { ProxyRepositoryPort } from './proxy-repository.port.js';
import type { ProxyReputationRepositoryPort } from './proxy-reputation-repository.port.js';

export type { ProxyAttemptInterface } from '../domain/proxy-attempt.interface.js';

/** Learns from the attempts of the workers which proxies read a marketplace, and which it turns away. */
export class RecordProxyAttemptsUseCase {
  constructor(
    private readonly proxies: ProxyRepositoryPort,
    private readonly reputations: ProxyReputationRepositoryPort,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  async execute(attempts: ProxyAttemptInterface[]): Promise<void> {
    const servers = Array.from(new Set(attempts.map(({ server }): string => server)));
    if (servers.length === 0) return;

    // An attempt through a proxy that is gone meanwhile (deleted, or dropped) must not bring it back.
    const stored = new Set(
      (await this.proxies.findByServers(servers)).map(({ snapshot }): string => snapshot.server),
    );
    const keyOf = (server: string, marketplace: string): string => `${marketplace} ${server}`;
    const known = new Map(
      (await this.reputations.findByServers(servers)).map(
        (reputation): [string, ProxyReputationEntity] => [
          keyOf(reputation.snapshot.server, reputation.snapshot.marketplace),
          reputation,
        ],
      ),
    );

    // Several attempts through one proxy are applied in order.
    const updated = new Map<string, ProxyReputationEntity>();
    for (const attempt of attempts) {
      if (!stored.has(attempt.server)) continue;

      const key = keyOf(attempt.server, attempt.marketplace);
      const next = ProxyReputationEntity.fromAttempt(attempt, updated.get(key) ?? known.get(key));
      if (next !== undefined) updated.set(key, next);
    }

    await this.reputations.saveMany(Array.from(updated.values()));
    this.logger.debug(
      `Recorded ${String(attempts.length)} attempts through ${String(updated.size)} proxies`,
    );
  }
}
