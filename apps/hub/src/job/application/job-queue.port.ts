import type { HandbookType, ProxySourceType } from 'queue-contract';

export const JOB_QUEUE = Symbol('JobQueuePort');

export interface ProxyFetchRequestInterface {
  jobId: string;
  source: ProxySourceType;
  maxCandidates: number;
  /** Proxies of the store to check as well. */
  recheck: string[];
  probeTimeoutMs: number;
}

export interface RouteInterface {
  /** Proxy URL in the order of trying; null is a direct connection. */
  server: string | null;
}

export interface PriceFetchRequestInterface {
  jobId: string;
  routes: RouteInterface[];
  products: Array<{ trackedProductId: string; url: string; cityId?: string; cityName?: string }>;
  timeoutMs: number;
  /** How long the job waits in the queue before a worker may take it; none when not said. */
  delayMs?: number;
}

export interface HandbookFetchRequestInterface {
  jobId: string;
  handbook: HandbookType;
  /** Proxy URLs in the order of trying; null is a direct connection. */
  proxies: Array<string | null>;
}

export interface JobQueuePort {
  enqueueProxyFetch(request: ProxyFetchRequestInterface): Promise<void>;
  enqueuePriceFetch(request: PriceFetchRequestInterface): Promise<void>;
  enqueueHandbookFetch(request: HandbookFetchRequestInterface): Promise<void>;
}
