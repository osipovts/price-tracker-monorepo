export interface PriceObservationInterface {
  amountMinor: number;
  currency: 'RUB';
}

export interface ProductSnapshotInterface {
  title: string;
  observedAt: string;
  prices: PriceObservationInterface[];
  availability: 'in_stock' | 'out_of_stock' | 'unknown';
  /** The picture of the product on its page; null when the page shows none. */
  imageUrl: string | null;
}

/**
 * Where an attempt failed: `preflight`, the route did not reach the site before a browser was opened; `exit`, the
 * check of the exit country of the route; `page`, the pages of the site.
 */
export type ReadStageType = 'preflight' | 'exit' | 'page';

export type ReadProductResultType =
  | { status: 'success' | 'partial'; snapshot: ProductSnapshotInterface; exitIp: string | null }
  | {
      status:
        'challenge_required' | 'network_error' | 'proxy_rejected' | 'parse_error' | 'http_error';
      httpStatus?: number;
      /** The pages of the site when it is not given. */
      stage?: ReadStageType;
    };

export interface ProductAttemptInterface {
  proxy: string | null;
  result: ReadProductResultType;
  /** How long the attempt took, the check of the route included. */
  durationMs: number;
}

export interface TrackingResultInterface {
  status: ReadProductResultType['status'] | 'no_proxies';
  attempts: ProductAttemptInterface[];
}
