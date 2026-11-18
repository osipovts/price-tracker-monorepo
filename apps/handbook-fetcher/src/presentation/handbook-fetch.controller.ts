import { type LoggerPort, silentLogger } from 'logger';
import { ProxyEndpointEntity } from 'proxy-endpoint';
import {
  handbookFetchJobSchema,
  type HandbookFetchJobType,
  type HandbookFetchResultType,
  type HandbookType,
} from 'queue-contract';
import type { JobLifecycleReporter, QueueMessageParser } from 'queue-worker';

import type { FetchCitiesUseCase } from '../application/fetch-cities.use-case.js';

/** Indexed by the contract handbook, so a handbook unknown to the worker fails to compile. */
type HandbookUseCasesType = Record<HandbookType, { execute: FetchCitiesUseCase['execute'] }>;

export class HandbookFetchController {
  constructor(
    private readonly useCases: HandbookUseCasesType,
    private readonly messages: QueueMessageParser,
    private readonly lifecycle: JobLifecycleReporter,
    private readonly publish: (message: HandbookFetchResultType) => Promise<void>,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  /** `willRetry` tells whether the queue is going to deliver the job again after a failure. */
  async handle(data: unknown, signal: AbortSignal, willRetry = false): Promise<void> {
    const job = await this.lifecycle.parse(
      this.messages,
      handbookFetchJobSchema,
      data,
      'handbook fetch job',
    );
    this.logger.info(
      `Job ${job.jobId} started: ${job.handbook} through ${String(job.proxies.length)} routes`,
    );

    await this.lifecycle.run(job.jobId, willRetry, (): Promise<void> => this.fetch(job, signal));
  }

  private async fetch(job: HandbookFetchJobType, signal: AbortSignal): Promise<void> {
    const cities = await this.useCases[job.handbook].execute(this.routesOf(job), signal, {
      onProgress: (done, total): Promise<void> =>
        this.publish({
          type: 'job_progress',
          jobId: job.jobId,
          processed: done,
          total,
          succeeded: done,
        }),
    });

    await this.publish({
      type: 'handbook_cities',
      jobId: job.jobId,
      handbook: job.handbook,
      cities,
    });
  }

  private routesOf(job: HandbookFetchJobType): Array<ProxyEndpointEntity | null> {
    const routes: Array<ProxyEndpointEntity | null> = [];
    for (const server of job.proxies) {
      try {
        routes.push(server === null ? null : new ProxyEndpointEntity(server));
      } catch {
        // An unsafe or unsupported address is skipped like an unavailable proxy.
        this.logger.warn('Skipping a route with an unsafe or unsupported proxy address');
      }
    }

    return routes;
  }
}
