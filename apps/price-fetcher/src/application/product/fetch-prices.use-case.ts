import { setTimeout } from 'node:timers/promises';

import { type LoggerPort, silentLogger } from 'logger';
import type { ProductReferenceEntity, ResolveProductReferenceUseCase } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import type {
  ProductAttemptInterface,
  ReadProductResultType,
  TrackingResultInterface,
} from '../../domain/product/product-snapshot.interface.js';
import type { ProductReaderPort } from './product-reader.port.js';

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

/** What a later try may change: a route that hangs, a check of the site that passes, a card that has not been drawn. */
const retryableStatuses: ReadonlyArray<ProductFetchResultInterface['status']> = [
  'network_error',
  'proxy_rejected',
  'http_error',
  'challenge_required',
  'parse_error',
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

interface CandidateInterface {
  route: FetchPricesRouteInterface;
  proxy: ProxyEndpointEntity;
}

export function isRetryable(status: ProductFetchResultInterface['status']): boolean {
  return retryableStatuses.includes(status);
}

export function isRead(status: ProductFetchResultInterface['status'] | undefined): boolean {
  return status === 'success' || status === 'partial';
}

/** Reads the prices of the products of a job through its routes and reports what happened. */
export class FetchPricesUseCase {
  constructor(
    private readonly resolveReference: ResolveProductReferenceUseCase,
    private readonly createReader: (timeoutMs: number) => ProductReaderPort,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

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

    for (const product of job.products) {
      if (product.read === true) continue;

      signal.throwIfAborted();
      const result = await this.fetchProduct(
        product,
        candidates.map(({ proxy }): ProxyEndpointEntity => proxy),
        reader,
        signal,
      );
      candidates = this.reordered(candidates, result.attempts);
      await listener.onProduct(result);

      processed += 1;
      if (isRead(result.status)) succeeded += 1;
      await listener.onProgress({ processed, total, succeeded });
    }

    return [...candidates.map(({ route }): FetchPricesRouteInterface => route), ...unsafe];
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

  private async fetchProduct(
    product: { trackedProductId: string; url: string; cityId?: string | undefined },
    candidates: readonly ProxyEndpointEntity[],
    reader: ProductReaderPort,
    signal: AbortSignal,
  ): Promise<ProductFetchResultInterface> {
    let reference: ProductReferenceEntity;
    try {
      reference = this.resolveReference.execute(product.url).inCity(product.cityId ?? null);
    } catch {
      this.logger.warn(`Product ${product.trackedProductId}: unsupported URL`);

      return { trackedProductId: product.trackedProductId, status: 'invalid_url', attempts: [] };
    }

    this.logger.info(
      `Product ${product.trackedProductId} (${reference.marketplace} ${reference.id}): reading`,
    );
    const result = await this.readProduct(reference, candidates, reader, signal);
    this.logger.info(
      `Product ${product.trackedProductId}: ${result.status} after ${String(result.attempts.length)} attempts`,
    );

    return {
      trackedProductId: product.trackedProductId,
      status: result.status,
      attempts: result.attempts,
    };
  }

  /** Tries the routes in order until the site gives an answer that another route cannot change. */
  private async readProduct(
    reference: ProductReferenceEntity,
    candidates: readonly ProxyEndpointEntity[],
    reader: ProductReaderPort,
    signal: AbortSignal,
  ): Promise<TrackingResultInterface> {
    const output: TrackingResultInterface = { status: 'no_proxies', attempts: [] };
    this.logger.debug(`${String(candidates.length)} routes to try`);

    for (const proxy of candidates) {
      signal.throwIfAborted();
      if (output.attempts.length > 0) await setTimeout(1000, undefined, { signal });

      const route = `Attempt ${String(output.attempts.length + 1)} via ${proxy.server}`;
      this.logger.verbose(route);
      const startedAt = performance.now();
      const result = await reader.read(reference, proxy, signal);
      this.logger.verbose(
        `${route}: ${result.status} in ${String(Math.round(performance.now() - startedAt))} ms`,
      );

      output.attempts.push({ proxy: proxy.server, result });
      output.status = result.status;
      // A challenge is a site decision, not a dead proxy: do not rotate to evade it.
      if (
        ['success', 'partial', 'challenge_required', 'parse_error', 'http_error'].includes(
          result.status,
        )
      )
        break;
    }

    return output;
  }
}
