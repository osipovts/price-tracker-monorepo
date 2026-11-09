import type { MarketplaceType } from 'product-reference';

/** What a worker came to reading a product of a marketplace through a proxy. */
export type ProxyAttemptStatusType =
  | 'success'
  | 'partial'
  | 'challenge_required'
  | 'network_error'
  | 'proxy_rejected'
  | 'parse_error'
  | 'http_error';

/**
 * Where an attempt failed: `preflight`, the route did not reach the site before a browser was opened; `exit`, the
 * check of the exit country of the route; `page`, the pages of the site.
 */
export type ProxyAttemptStageType = 'preflight' | 'exit' | 'page';

export interface ProxyAttemptInterface {
  /** Proxy URL without credentials. */
  server: string;
  marketplace: MarketplaceType;
  status: ProxyAttemptStatusType;
  /** The status of the answer of the marketplace, for an `http_error`; null otherwise. */
  httpStatus: number | null;
  /** Where a failed attempt failed; null for a read, or from an older worker. */
  stage: ProxyAttemptStageType | null;
  /** How long the attempt took; null from an older worker. */
  durationMs: number | null;
  attemptedAt: Date;
}
