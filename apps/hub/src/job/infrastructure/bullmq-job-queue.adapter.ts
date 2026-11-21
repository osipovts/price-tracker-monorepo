import { type JobsOptions, Queue } from 'bullmq';
import { type LoggerPort, silentLogger } from 'logger';
import {
  handbookFetchJobSchema,
  type HandbookFetchJobType,
  priceFetchJobSchema,
  type PriceFetchJobType,
  proxyFetchJobSchema,
  type ProxyFetchJobType,
  queueNames,
} from 'queue-contract';

import type {
  HandbookFetchRequestInterface,
  JobQueuePort,
  PriceFetchRequestInterface,
  ProxyFetchRequestInterface,
} from '../application/job-queue.port.js';

const jobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 86400 },
};

/** A price read that found nothing comes back after a cooldown: a hung route or a check of the site often passes by then. */
export interface PriceFetchRetryOptionsInterface {
  attempts: number;
  backoffMs: number;
}

const defaultPriceFetchRetryOptions: PriceFetchRetryOptionsInterface = {
  attempts: 2,
  backoffMs: 5 * 60_000,
};

export class BullmqJobQueueAdapter implements JobQueuePort {
  private readonly proxyFetchQueue: Queue;
  private readonly priceFetchQueue: Queue;
  private readonly handbookFetchQueue: Queue;
  private readonly priceFetchJobOptions: JobsOptions;

  constructor(
    redisUrl: string,
    private readonly logger: LoggerPort = silentLogger,
    priceFetchRetry: PriceFetchRetryOptionsInterface = defaultPriceFetchRetryOptions,
  ) {
    this.priceFetchJobOptions = {
      ...jobOptions,
      attempts: priceFetchRetry.attempts,
      backoff: { type: 'fixed', delay: priceFetchRetry.backoffMs },
    };
    const connection = { url: redisUrl };
    this.proxyFetchQueue = new Queue(queueNames.proxyFetchJobs, { connection });
    this.priceFetchQueue = new Queue(queueNames.priceFetchJobs, { connection });
    this.handbookFetchQueue = new Queue(queueNames.handbookFetchJobs, { connection });

    for (const queue of [this.proxyFetchQueue, this.priceFetchQueue, this.handbookFetchQueue]) {
      queue.on('error', (error): void => {
        this.logger.error(`Queue ${queue.name} error: ${error.message}`);
      });
    }
  }

  async enqueueProxyFetch(request: ProxyFetchRequestInterface): Promise<void> {
    const job: ProxyFetchJobType = proxyFetchJobSchema.parse(request);
    await this.proxyFetchQueue.add('proxy-fetch', job, { ...jobOptions, jobId: job.jobId });
    this.logger.debug(`Published proxy-fetch ${job.jobId} to ${queueNames.proxyFetchJobs}`);
  }

  async enqueuePriceFetch(request: PriceFetchRequestInterface): Promise<void> {
    const job: PriceFetchJobType = priceFetchJobSchema.parse({
      jobId: request.jobId,
      proxies: request.routes,
      products: request.products,
      timeoutMs: request.timeoutMs,
    });
    await this.priceFetchQueue.add('price-fetch', job, {
      ...this.priceFetchJobOptions,
      ...(request.delayMs === undefined || request.delayMs <= 0 ? {} : { delay: request.delayMs }),
      jobId: job.jobId,
    });
    this.logger.debug(`Published price-fetch ${job.jobId} to ${queueNames.priceFetchJobs}`);
  }

  async enqueueHandbookFetch(request: HandbookFetchRequestInterface): Promise<void> {
    const job: HandbookFetchJobType = handbookFetchJobSchema.parse(request);
    await this.handbookFetchQueue.add('handbook-fetch', job, { ...jobOptions, jobId: job.jobId });
    this.logger.debug(`Published handbook-fetch ${job.jobId} to ${queueNames.handbookFetchJobs}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([
      this.proxyFetchQueue.close(),
      this.priceFetchQueue.close(),
      this.handbookFetchQueue.close(),
    ]);
  }
}
