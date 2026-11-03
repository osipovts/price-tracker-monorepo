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

export interface ProxyAttemptInterface {
  /** Proxy URL without credentials. */
  server: string;
  marketplace: MarketplaceType;
  status: ProxyAttemptStatusType;
  /** The status of the answer of the marketplace, for an `http_error`; null otherwise. */
  httpStatus: number | null;
  attemptedAt: Date;
}
