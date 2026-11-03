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

    const statuses = new Map<string, ProductFetchResultInterface['status']>();
    await this.lifecycle.run(job.jobId, willRetry, async (): Promise<void> => {
      const routes = await this.fetchPrices.execute(
        {
          routes: job.proxies,
          products: job.products,
          timeoutMs: job.timeoutMs,
        },
        signal,
        this.listenerOf(job.jobId, statuses),
      );

      // The queue brings a failed job back after a pause; a job that read no price does not fail by itself.
      const marked = job.products.map((product): PriceFetchJobType['products'][number] =>
        product.read === true || isRead(statuses.get(product.trackedProductId))
          ? { ...product, read: true }
          : product,
      );
      const unread = marked.filter(({ trackedProductId, read }): boolean => {
        const status = statuses.get(trackedProductId);

        return read !== true && status !== undefined && isRetryable(status);
      });
      if (unread.length === 0) return;

      // The next try starts on the routes that did not fail this one.
      if (willRetry) await retryWith({ ...job, proxies: routes, products: marked });
      // The job that leaves a product unread fails, on the last try too: what was read is recorded already.
      throw new Error(`${String(unread.length)} products could not be read`);
    });
  }

  private listenerOf(
    jobId: string,
    statuses: Map<string, ProductFetchResultInterface['status']>,
  ): FetchPricesListenerInterface {
    return {
      onProgress: (progress): Promise<void> =>
        this.publish({ type: 'job_progress', jobId, ...progress }),
      onProduct: (result): Promise<void> => {
        statuses.set(result.trackedProductId, result.status);

        return this.publish({ type: 'product_result', jobId, ...result });
      },
    };
  }
}
