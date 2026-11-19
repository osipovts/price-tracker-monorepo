import { type LoggerPort, silentLogger } from 'logger';
import {
  priceFetchJobSchema,
  type PriceFetchJobType,
  type PriceFetchResultType,
} from 'queue-contract';
import type { JobLifecycleReporter, QueueMessageParser } from 'queue-worker';

import {
  type FetchPricesListenerInterface,
  type FetchPricesUseCase,
  isRead,
  isRetryable,
  type ProductFetchResultInterface,
} from '../../application/product/fetch-prices.use-case.js';
import type {
  ProductAttemptInterface,
  ReadProductResultType,
} from '../../domain/product/product-snapshot.interface.js';

function formatOutcome(result: ReadProductResultType): string {
  return result.status === 'http_error' && result.httpStatus !== undefined
    ? `http_error ${String(result.httpStatus)}`
    : result.status;
}

function formatAttempt(attempt: ProductAttemptInterface): string {
  const route = attempt.proxy ?? 'direct';
  const outcome = formatOutcome(attempt.result);
  const failure = 'snapshot' in attempt.result ? null : attempt.result;
  const stage = failure?.stage !== undefined ? ` [${failure.stage}]` : '';
  const detail =
    failure?.detail !== undefined && failure.detail !== '' ? `: ${failure.detail}` : '';

  return `${route} -> ${outcome}${stage} ${String(attempt.durationMs)}ms${detail}`;
}

function finalLabelOf(result: ProductFetchResultInterface | undefined): string {
  if (result === undefined) return 'unknown';

  const lastResult = result.attempts.at(-1)?.result;
  if (lastResult?.status === 'http_error' && lastResult.httpStatus !== undefined) {
    return `http_error ${String(lastResult.httpStatus)}`;
  }

  return result.status;
}

function formatUnreadError(
  totalProducts: number,
  unread: PriceFetchJobType['products'],
  results: ReadonlyMap<string, ProductFetchResultInterface>,
): string {
  const counts = new Map<string, number>();
  const lines = unread.map(({ trackedProductId, url, cityName }): string => {
    const result = results.get(trackedProductId);
    const label = finalLabelOf(result);
    counts.set(label, (counts.get(label) ?? 0) + 1);
    const city = cityName !== undefined && cityName !== '' ? ` (${cityName})` : '';
    const attempts = result?.attempts ?? [];
    const attemptsText =
      attempts.length > 0
        ? ` (${String(attempts.length)} ${attempts.length === 1 ? 'attempt' : 'attempts'}: ${attempts.map(formatAttempt).join('; ')})`
        : '';

    return `${url}${city}: ${label}${attemptsText}`;
  });
  const summary =
    unread.length === 1
      ? (counts.keys().next().value ?? 'unknown')
      : Array.from(counts.entries(), ([label, count]): string => `${String(count)}x ${label}`).join(
          ', ',
        );
  const header = `${String(unread.length)} of ${String(totalProducts)} products could not be read: ${summary}`;

  return [header, ...lines].join('\n');
}

export class PriceFetchController {
  constructor(
    private readonly fetchPrices: Pick<FetchPricesUseCase, 'execute'>,
    private readonly messages: QueueMessageParser,
    private readonly lifecycle: JobLifecycleReporter,
    private readonly publish: (message: PriceFetchResultType) => Promise<void>,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  /**
   * `willRetry` tells whether the queue is going to deliver the job again after a failure; `retryWith`
   * gives it the data to deliver then: the same job with the products that were read marked, so that they are not read twice,
   * and with the routes that failed moved to the end.
   */
  async handle(
    data: unknown,
    signal: AbortSignal,
    willRetry = false,
    retryWith: (job: PriceFetchJobType) => Promise<void> = (): Promise<void> => Promise.resolve(),
  ): Promise<void> {
    const job = await this.lifecycle.parse(
      this.messages,
      priceFetchJobSchema,
      data,
      'price fetch job',
    );
    this.logger.info(
      `Job ${job.jobId} started: ${String(job.products.length)} products, ${String(job.proxies.length)} routes, timeout ${String(job.timeoutMs)} ms`,
    );

    const results = new Map<string, ProductFetchResultInterface>();
    await this.lifecycle.run(job.jobId, willRetry, async (): Promise<void> => {
      const routes = await this.fetchPrices.execute(
        {
          routes: job.proxies,
          products: job.products,
          timeoutMs: job.timeoutMs,
        },
        signal,
        this.listenerOf(job.jobId, results),
      );

      // The queue brings a failed job back after a pause; a job that read no price does not fail by itself.
      const marked = job.products.map((product): PriceFetchJobType['products'][number] =>
        product.read === true || isRead(results.get(product.trackedProductId)?.status)
          ? { ...product, read: true }
          : product,
      );
      const unread = marked.filter(({ trackedProductId, read }): boolean => {
        const status = results.get(trackedProductId)?.status;

        return read !== true && status !== undefined && isRetryable(status);
      });
      if (unread.length === 0) return;

      // The next try starts on the routes that did not fail this one.
      if (willRetry) await retryWith({ ...job, proxies: routes, products: marked });
      // The job that leaves a product unread fails, on the last try too: what was read is recorded already.
      throw new Error(formatUnreadError(job.products.length, unread, results));
    });
  }

  private listenerOf(
    jobId: string,
    results: Map<string, ProductFetchResultInterface>,
  ): FetchPricesListenerInterface {
    return {
      onProgress: (progress): Promise<void> =>
        this.publish({ type: 'job_progress', jobId, ...progress }),
      onProduct: (result): Promise<void> => {
        results.set(result.trackedProductId, result);

        return this.publish({ type: 'product_result', jobId, ...result });
      },
    };
  }
}
