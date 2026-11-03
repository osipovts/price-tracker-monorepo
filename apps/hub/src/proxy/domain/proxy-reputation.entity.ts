import type { MarketplaceType } from 'product-reference';

import type { ProxyAttemptInterface, ProxyAttemptStatusType } from './proxy-attempt.interface.js';

/**
 * What an attempt through a proxy tells of the proxy, for the marketplace it read: `read`, the marketplace gave the
 * product card; `unreachable`, the proxy did not get through (a timeout, a refused or broken connection); `blocked`,
 * the marketplace turned the address away (a check of the site, or 401, 403, 429); `misplaced`, the proxy exits in
 * another country than the one the marketplace serves.
 */
export const proxyOutcomes = ['read', 'unreachable', 'blocked', 'misplaced'] as const;

export type ProxyOutcomeType = (typeof proxyOutcomes)[number];

/** The answers of a marketplace that refuse the address, not the request. */
const blockingHttpStatuses: readonly number[] = [401, 403, 429];

/** The proxy itself asks for credentials: it is the proxy that does not let through. */
const proxyAuthenticationRequired = 407;

/** An attempt weighs half as much after this time: free proxies change fast, and old history must not hold. */
export const reputationHalfLifeMs = 24 * 60 * 60 * 1000;

/** How long a proxy rests after its first failure in a row, and at most: each next failure doubles the rest. */
const cooldowns: Readonly<
  Record<Exclude<ProxyOutcomeType, 'read'>, { firstMs: number; maxMs: number }>
> = {
  unreachable: { firstMs: 2 * 60_000, maxMs: 2 * 60 * 60_000 },
  blocked: { firstMs: 60 * 60_000, maxMs: 24 * 60 * 60_000 },
  misplaced: { firstMs: 6 * 60 * 60_000, maxMs: 24 * 60 * 60_000 },
};

/** How many attempts the checks of a proxy weigh as, before the marketplace has said anything of it. */
const checkPriorWeight = 2;

export interface ProxyReputationInterface {
  /** Proxy URL without credentials. */
  server: string;
  marketplace: MarketplaceType;
  /** Reads through the proxy, faded with time. */
  successes: number;
  /** Failures through the proxy, faded with time. */
  failures: number;
  /** Failures in a row since the last read. */
  failureStreak: number;
  lastOutcome: ProxyOutcomeType;
  lastAttemptAt: Date;
  /** The proxy is not given for the marketplace until then; null when it does not rest. */
  cooldownUntil: Date | null;
}

/** The chance a proxy reads a marketplace, as the mean and the standard deviation of its estimate. */
export interface ReadChanceInterface {
  mean: number;
  deviation: number;
}

/** The value as it weighs at a time; a time before the value counts as the same time. */
function faded(value: number, from: Date, to: Date): number {
  const elapsedMs = Math.max(to.getTime() - from.getTime(), 0);

  return value * 0.5 ** (elapsedMs / reputationHalfLifeMs);
}

/** How a proxy has done reading a marketplace: the workers report every attempt they make through it. */
export class ProxyReputationEntity {
  constructor(readonly snapshot: ProxyReputationInterface) {}

  /** null for an answer the proxy has no part in: a card that is not parsed, a page that is gone, an error of the site. */
  static outcomeOf(
    status: ProxyAttemptStatusType,
    httpStatus: number | null,
  ): ProxyOutcomeType | null {
    switch (status) {
      case 'success':
      case 'partial':
        return 'read';
      case 'network_error':
        return 'unreachable';
      case 'challenge_required':
        return 'blocked';
      case 'proxy_rejected':
        return 'misplaced';
      case 'parse_error':
        return null;
      case 'http_error':
        if (httpStatus === proxyAuthenticationRequired) return 'unreachable';

        return httpStatus !== null && blockingHttpStatuses.includes(httpStatus) ? 'blocked' : null;
    }
  }

  /** Resting: the proxy is not given for the marketplace. */
  isCooling(now: Date): boolean {
    const { cooldownUntil } = this.snapshot;

    return cooldownUntil !== null && cooldownUntil > now;
  }

  /**
   * The reputation after an attempt; an attempt the proxy has no part in leaves it as it was. A read clears the
   * failures in a row and the rest. A failure makes the proxy rest, the longer the more failures in a row, and never
   * shortens a rest it is in: the marketplace is not asked through an address it has turned away.
   */
  static fromAttempt(
    attempt: ProxyAttemptInterface,
    previous?: ProxyReputationEntity,
  ): ProxyReputationEntity | undefined {
    const outcome = ProxyReputationEntity.outcomeOf(attempt.status, attempt.httpStatus);
    if (outcome === null) return previous;

    const known = previous?.snapshot;
    // An attempt reported late counts as of the last one.
    const at =
      known === undefined || attempt.attemptedAt > known.lastAttemptAt
        ? attempt.attemptedAt
        : known.lastAttemptAt;
    const successes = known === undefined ? 0 : faded(known.successes, known.lastAttemptAt, at);
    const failures = known === undefined ? 0 : faded(known.failures, known.lastAttemptAt, at);
    const base = { server: attempt.server, marketplace: attempt.marketplace, lastOutcome: outcome };

    if (outcome === 'read') {
      return new ProxyReputationEntity({
        ...base,
        successes: successes + 1,
        failures,
        failureStreak: 0,
        lastAttemptAt: at,
        cooldownUntil: null,
      });
    }

    const failureStreak = (known?.failureStreak ?? 0) + 1;
    const { firstMs, maxMs } = cooldowns[outcome];
    const restUntil = new Date(
      attempt.attemptedAt.getTime() + Math.min(firstMs * 2 ** (failureStreak - 1), maxMs),
    );
    const resting = known?.cooldownUntil ?? null;

    return new ProxyReputationEntity({
      ...base,
      successes,
      failures: failures + 1,
      failureStreak,
      lastAttemptAt: at,
      cooldownUntil: resting !== null && resting > restUntil ? resting : restUntil,
    });
  }

  /**
   * The chance a proxy reads the marketplace, by a Beta distribution over its faded reads and failures. The checks of
   * the proxy, which tell only that it is alive, give a weak prior; a proxy the marketplace has not seen yet has a
   * wide deviation, so that it gets its turn.
   */
  static chanceOf(
    reputation: ProxyReputationEntity | undefined,
    checkRate: number,
    now: Date,
  ): ReadChanceInterface {
    const known = reputation?.snapshot;
    const successes = known === undefined ? 0 : faded(known.successes, known.lastAttemptAt, now);
    const failures = known === undefined ? 0 : faded(known.failures, known.lastAttemptAt, now);
    const alpha = 1 + checkPriorWeight * checkRate + successes;
    const beta = 1 + checkPriorWeight * (1 - checkRate) + failures;
    const total = alpha + beta;

    return {
      mean: alpha / total,
      deviation: Math.sqrt((alpha * beta) / (total * total * (total + 1))),
    };
  }
}
