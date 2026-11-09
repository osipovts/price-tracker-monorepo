import { setTimeout } from 'node:timers/promises';

import { type LoggerPort, silentLogger } from 'logger';
import type {
  MarketplaceType,
  ProductReferenceEntity,
  ResolveProductReferenceUseCase,
} from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import type {
  ProductAttemptInterface,
  ReadProductResultType,
  TrackingResultInterface,
} from '../../domain/product/product-snapshot.interface.js';
import type { ProductBatchReaderPort } from './product-batch-reader.port.js';
import type { RouteProbePort } from './route-probe.port.js';

export interface FetchPricesRouteInterface {
  /** Proxy URL, with the credentials if it has them. */
  server: string;
}

export interface FetchPricesJobInterface {
  /** Routes in the order they are tried: a product is never read without a proxy. */
  routes: readonly FetchPricesRouteInterface[];
  products: ReadonlyArray<{
    trackedProductId: string;
    url: string;
    cityId?: string | undefined;
    /** Read by an earlier try: it is counted as done and not read again. */
    read?: boolean | undefined;
  }>;
  timeoutMs: number;
}

export interface ProductFetchResultInterface {
  trackedProductId: string;
  status: TrackingResultInterface['status'] | 'invalid_url';
  attempts: ProductAttemptInterface[];
}

export interface FetchPricesListenerInterface {
  onProgress(progress: { processed: number; total: number; succeeded: number }): Promise<void>;
  onProduct(result: ProductFetchResultInterface): Promise<void>;
}

export interface FetchPricesOptionsInterface {
  /** Tells whether a route reaches the site before a browser is opened for it; without it every route is tried. */
  probe?: RouteProbePort;
  /** How many products of a marketplace in one city one visit of the site reads; one where none is given. */
  batchLimits?: Readonly<Partial<Record<MarketplaceType, number>>>;
}

/** What a later try may change: a route that hangs, a check of the site that passes, a card that has not been drawn. */
const retryableStatuses: ReadonlyArray<ProductFetchResultInterface['status']> = [
  'network_error',
  'proxy_rejected',
  'http_error',
  'challenge_required',
  'parse_error',
];

/** The answers another route does not change. A challenge is a site decision, not a dead proxy: it is not evaded. */
const finalStatuses: ReadonlyArray<ReadProductResultType['status']> = [
  'success',
  'partial',
  'challenge_required',
  'parse_error',
  'http_error',
];

/** The answers that refuse the address of the proxy, or come from the proxy itself, rather than from the page. */
const routeRefusalHttpStatuses: readonly number[] = [401, 403, 407, 429];

/** A route the job tried and that failed for a reason of its own: the next product tries it last. */
function isRouteFailure(result: ReadProductResultType): boolean {
  switch (result.status) {
    case 'network_error':
    case 'proxy_rejected':
    case 'challenge_required':
      return true;
    case 'http_error':
      return (
        result.httpStatus !== undefined && routeRefusalHttpStatuses.includes(result.httpStatus)
      );
    case 'success':
    case 'partial':
    case 'parse_error':
      return false;
  }
}

/** A failure the reader did not place happened on the pages of the site. */
function withStage(result: ReadProductResultType): ReadProductResultType {
  return 'snapshot' in result || result.stage !== undefined ? result : { ...result, stage: 'page' };
}

const everyRouteReaches: RouteProbePort = {
  reaches: (): Promise<boolean> => Promise.resolve(true),
};

interface CandidateInterface {
  route: FetchPricesRouteInterface;
  proxy: ProxyEndpointEntity;
}

interface ProductToReadInterface {
  trackedProductId: string;
  reference: ProductReferenceEntity;
}

/** A product of a batch and what its reading has come to so far. */
interface ReadingInterface {
  product: ProductToReadInterface;
  output: TrackingResultInterface;
}

export function isRetryable(status: ProductFetchResultInterface['status']): boolean {
  return retryableStatuses.includes(status);
}

export function isRead(status: ProductFetchResultInterface['status'] | undefined): boolean {
  return status === 'success' || status === 'partial';
}

/**
 * Reads the prices of the products of a job through its routes and reports what happened. The products of a
 * marketplace that reads several at once are read in batches of one city, a visit of the site for a batch.
 */
export class FetchPricesUseCase {
  private readonly probe: RouteProbePort;
  private readonly batchLimits: Readonly<Partial<Record<MarketplaceType, number>>>;

  constructor(
    private readonly resolveReference: ResolveProductReferenceUseCase,
    private readonly createReader: (timeoutMs: number) => ProductBatchReaderPort,
    private readonly logger: LoggerPort = silentLogger,
    options: FetchPricesOptionsInterface = {},
  ) {
    this.probe = options.probe ?? everyRouteReaches;
    this.batchLimits = options.batchLimits ?? {};
  }

  /**
   * Returns the routes in the order a next try of the job should take them: the job learns as it goes which of its
   * routes reach the marketplace, and a next try does not start on the ones that failed.
   */
  async execute(
    job: FetchPricesJobInterface,
    signal: AbortSignal,
    listener: FetchPricesListenerInterface,
  ): Promise<FetchPricesRouteInterface[]> {
    let candidates: CandidateInterface[] = [];
    const unsafe: FetchPricesRouteInterface[] = [];
    for (const route of job.routes) {
      try {
        candidates.push({ route, proxy: new ProxyEndpointEntity(route.server) });
      } catch {
        // An unsafe or unsupported address is skipped like an unavailable proxy.
        this.logger.warn('Skipping a route with an unsafe or unsupported proxy address');
        unsafe.push(route);
      }
    }

    const reader = this.createReader(job.timeoutMs);
    const total = job.products.length;
    let processed = job.products.filter(({ read }): boolean => read === true).length;
    let succeeded = processed;
    await listener.onProgress({ processed, total, succeeded });

    const report = async (result: ProductFetchResultInterface): Promise<void> => {
      await listener.onProduct(result);
      processed += 1;
      if (isRead(result.status)) succeeded += 1;
      await listener.onProgress({ processed, total, succeeded });
    };

    const toRead: ProductToReadInterface[] = [];
    for (const product of job.products) {
      if (product.read === true) continue;

      const reference = this.referenceOf(product);
      if (reference === null) {
        await report({
          trackedProductId: product.trackedProductId,
          status: 'invalid_url',
          attempts: [],
        });
      } else {
        toRead.push({ trackedProductId: product.trackedProductId, reference });
      }
    }

    for (const batch of this.batchesOf(toRead)) {
      signal.throwIfAborted();
      const readings = await this.readBatch(
        batch,
        candidates.map(({ proxy }): ProxyEndpointEntity => proxy),
        reader,
        signal,
      );
      const longest = readings.reduce<ProductAttemptInterface[]>(
        (attempts, { output }): ProductAttemptInterface[] =>
          output.attempts.length > attempts.length ? output.attempts : attempts,
        [],
      );
      candidates = this.reordered(candidates, longest);

      for (const { product, output } of readings) {
        await report({
          trackedProductId: product.trackedProductId,
          status: output.status,
          attempts: output.attempts,
        });
      }
    }

    return [...candidates.map(({ route }): FetchPricesRouteInterface => route), ...unsafe];
  }

  /** Null for a link that is not of a product of a known marketplace. */
  private referenceOf(
    product: FetchPricesJobInterface['products'][number],
  ): ProductReferenceEntity | null {
    try {
      return this.resolveReference.execute(product.url).inCity(product.cityId ?? null);
    } catch {
      this.logger.warn(`Product ${product.trackedProductId}: unsupported URL`);

      return null;
    }
  }

  /** The products by marketplace and city, in the order of the job, cut to the batch limit of the marketplace. */
  private batchesOf(products: readonly ProductToReadInterface[]): ProductToReadInterface[][] {
    const groups = new Map<string, ProductToReadInterface[]>();
    for (const product of products) {
      const key = `${product.reference.marketplace} ${product.reference.cityId ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), product]);
    }

    return Array.from(groups.values()).flatMap((group): ProductToReadInterface[][] => {
      const [first] = group;
      const limit = Math.max(
        first === undefined ? 1 : (this.batchLimits[first.reference.marketplace] ?? 1),
        1,
      );
      const batches: ProductToReadInterface[][] = [];
      for (let from = 0; from < group.length; from += limit) {
        batches.push(group.slice(from, from + limit));
      }

      return batches;
    });
  }

  /**
   * The routes in the order the next product takes them: the one that read the last product first, the ones that
   * failed it for a reason of their own last, in the order they failed; the others keep their order in between.
   */
  private reordered(
    candidates: readonly CandidateInterface[],
    attempts: readonly ProductAttemptInterface[],
  ): CandidateInterface[] {
    const read = attempts.find(({ result }): boolean => isRead(result.status))?.proxy;
    const failed = attempts
      .filter(({ result }): boolean => isRouteFailure(result))
      .map(({ proxy }): string | null => proxy);
    // The one that read, then the untried and the unharmed ones, then the failed ones from the first to fail.
    const rank = ({ proxy }: CandidateInterface): number =>
      proxy.server === read ? -1 : failed.indexOf(proxy.server) + 1;

    return candidates.toSorted((a, b): number => rank(a) - rank(b));
  }

  /**
   * Tries the routes in order until the site gives each product of the batch an answer that another route cannot
   * change; a route is tried for the products that are still open.
   */
  private async readBatch(
    batch: readonly ProductToReadInterface[],
    candidates: readonly ProxyEndpointEntity[],
    reader: ProductBatchReaderPort,
    signal: AbortSignal,
  ): Promise<ReadingInterface[]> {
    const readings = batch.map((product): ReadingInterface => ({
      product,
      output: { status: 'no_proxies', attempts: [] },
    }));
    for (const { trackedProductId, reference } of batch) {
      this.logger.info(
        `Product ${trackedProductId} (${reference.marketplace} ${reference.id}): reading`,
      );
    }
    this.logger.debug(`${String(candidates.length)} routes to try`);

    let open = readings;
    let tries = 0;
    for (const proxy of candidates) {
      if (open.length === 0) break;

      signal.throwIfAborted();
      if (tries > 0) await setTimeout(1000, undefined, { signal });
      tries += 1;

      const route = `Attempt ${String(tries)} via ${proxy.server}`;
      this.logger.verbose(`${route} for ${String(open.length)} products`);
      const startedAt = performance.now();
      const results = await this.attempt(
        open.map(({ product }): ProductReferenceEntity => product.reference),
        proxy,
        reader,
        signal,
      );
      const durationMs = Math.round(performance.now() - startedAt);

      const still: ReadingInterface[] = [];
      for (const [index, reading] of open.entries()) {
        const result = results[index] ?? { status: 'parse_error' };
        // The first product of the visit tells of it; the others share it.
        reading.output.attempts.push({
          proxy: proxy.server,
          result,
          durationMs,
          shared: index > 0,
        });
        reading.output.status = result.status;
        if (!finalStatuses.includes(result.status)) still.push(reading);
      }
      this.logger.verbose(
        `${route}: ${results.map(({ status }): string => status).join(', ')} in ${String(durationMs)} ms`,
      );
      open = still;
    }

    for (const { product, output } of readings) {
      this.logger.info(
        `Product ${product.trackedProductId}: ${output.status} after ${String(output.attempts.length)} attempts`,
      );
    }

    return readings;
  }

  /** A route that does not reach the site fails at once, without a browser. */
  private async attempt(
    references: readonly ProductReferenceEntity[],
    proxy: ProxyEndpointEntity,
    reader: ProductBatchReaderPort,
    signal: AbortSignal,
  ): Promise<ReadProductResultType[]> {
    const [first] = references;
    if (first === undefined) return [];

    const host = new URL(first.url).hostname;
    const reaches = await this.probe.reaches(proxy, host, signal);
    signal.throwIfAborted();
    if (!reaches) {
      this.logger.warn(`The route via ${proxy.server} did not reach ${host}`);

      return references.map((): ReadProductResultType => ({
        status: 'network_error',
        stage: 'preflight',
      }));
    }

    return (await reader.readMany(references, proxy, signal)).map(withStage);
  }
}
