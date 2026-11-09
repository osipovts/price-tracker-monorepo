import type { MarketplaceType } from 'product-reference';

import type {
  ProxyAttemptInterface,
  ProxyAttemptStageType,
  ProxyAttemptStatusType,
} from './proxy-attempt.interface.js';

/**
 * What an attempt through a proxy tells of the proxy, for the marketplace it read: `read`, the marketplace gave the
 * product card; `unreachable`, the pages of the marketplace did not come through (a timeout, a refused or broken
 * connection); `blocked`, the marketplace turned the address away (a check of the site, or 401, 403, 429);
 * `misplaced`, the proxy exits in another country than the one the marketplace serves; `down`, the proxy itself did
 * not let through: no tunnel to the site, no answer of the check of its exit, or it asked for credentials. A proxy
 * that is down is down for every marketplace.
 */
export const proxyOutcomes = ['read', 'unreachable', 'blocked', 'misplaced', 'down'] as const;

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
  down: { firstMs: 2 * 60_000, maxMs: 2 * 60 * 60_000 },
  blocked: { firstMs: 60 * 60_000, maxMs: 24 * 60 * 60_000 },
  misplaced: { firstMs: 6 * 60 * 60_000, maxMs: 24 * 60 * 60_000 },
};

/**
 * How many attempts what is known of the marketplace weighs as for a proxy, before the marketplace has said
 * anything of it: a proxy that is alive for a GeoIP service is far from sure to read a marketplace.
 */
const priorWeight = 4;

/** The share of the attempts that read a marketplace, before any is known: as if one of ten had. */
const baseRatePrior = { reads: 1, attempts: 10 };

/** How much a new read weighs in the time a read takes through the proxy. */
const readTimeWeight = 0.3;

/** The stages of an attempt where only the proxy can fail: the site is not asked anything yet. */
const proxyStages: ReadonlyArray<ProxyAttemptStageType | null> = ['preflight', 'exit'];

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
  /** How long a visit of the marketplace through the proxy takes when it reads, averaged; null until one is timed. */
  readMs: number | null;
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
    stage: ProxyAttemptStageType | null = null,
  ): ProxyOutcomeType | null {
    switch (status) {
      case 'success':
      case 'partial':
        return 'read';
      case 'network_error':
        return proxyStages.includes(stage) ? 'down' : 'unreachable';
      case 'challenge_required':
        return 'blocked';
      case 'proxy_rejected':
        return 'misplaced';
      case 'parse_error':
        return null;
      case 'http_error':
        if (httpStatus === proxyAuthenticationRequired) return 'down';

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
    const outcome = ProxyReputationEntity.outcomeOf(
      attempt.status,
      attempt.httpStatus,
      attempt.stage,
    );
    if (outcome === null) return previous;

    const known = previous?.snapshot;
    // An attempt reported late counts as of the last one.
    const at =
      known === undefined || attempt.attemptedAt > known.lastAttemptAt
        ? attempt.attemptedAt
        : known.lastAttemptAt;
    const successes = known === undefined ? 0 : faded(known.successes, known.lastAttemptAt, at);
    const failures = known === undefined ? 0 : faded(known.failures, known.lastAttemptAt, at);
    const readMs = known?.readMs ?? null;
    const base = {
      server: attempt.server,
      marketplace: attempt.marketplace,
      lastOutcome: outcome,
      readMs,
    };

    if (outcome === 'read') {
      const { durationMs } = attempt;

      return new ProxyReputationEntity({
        ...base,
        successes: successes + 1,
        failures,
        failureStreak: 0,
        readMs:
          durationMs === null
            ? readMs
            : readMs === null
              ? durationMs
              : readMs + (durationMs - readMs) * readTimeWeight,
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

  /** Down for every marketplace: the last attempt through the proxy, wherever it went, found it down, and it rests. */
  static isDown(reputations: readonly ProxyReputationEntity[], now: Date): boolean {
    const last = reputations.reduce<ProxyReputationEntity | undefined>(
      (latest, reputation): ProxyReputationEntity =>
        latest === undefined || reputation.snapshot.lastAttemptAt > latest.snapshot.lastAttemptAt
          ? reputation
          : latest,
      undefined,
    );

    return last?.snapshot.lastOutcome === 'down' && last.isCooling(now);
  }

  /** The share of the attempts through the proxies that read the marketplace, the old ones faded. */
  static baseRateOf(reputations: readonly ProxyReputationEntity[], now: Date): number {
    let reads = baseRatePrior.reads;
    let attempts = baseRatePrior.attempts;
    for (const { snapshot } of reputations) {
      const successes = faded(snapshot.successes, snapshot.lastAttemptAt, now);
      reads += successes;
      attempts += successes + faded(snapshot.failures, snapshot.lastAttemptAt, now);
    }

    return reads / attempts;
  }

  /**
   * The chance a proxy reads the marketplace, by a Beta distribution over its faded reads and failures. Before the
   * marketplace has said anything of the proxy, its chance is the share of the attempts that read the marketplace
   * through any proxy, with a wide deviation, so that it gets its turn to explore.
   */
  static chanceOf(
    reputation: ProxyReputationEntity | undefined,
    baseRate: number,
    now: Date,
  ): ReadChanceInterface {
    const known = reputation?.snapshot;
    const successes = known === undefined ? 0 : faded(known.successes, known.lastAttemptAt, now);
    const failures = known === undefined ? 0 : faded(known.failures, known.lastAttemptAt, now);
    const alpha = priorWeight * baseRate + successes;
    const beta = priorWeight * (1 - baseRate) + failures;
    const total = alpha + beta;

    return {
      mean: alpha / total,
      deviation: Math.sqrt((alpha * beta) / (total * total * (total + 1))),
    };
  }
}
