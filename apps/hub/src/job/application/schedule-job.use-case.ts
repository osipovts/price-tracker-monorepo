import { randomUUID } from 'node:crypto';

import { errorMessage } from 'logger';
import { formatFailureReason } from 'queue-worker';

import { JobEntity } from '../domain/job.entity.js';
import type { JobQueuePort } from './job-queue.port.js';
import type { JobRepositoryPort } from './job-repository.port.js';
import type { JobRequestType } from './job-request.type.js';

/** Records a job and publishes it to its worker; a job the queue refused is failed for good. */
export class ScheduleJobUseCase {
  constructor(
    private readonly queue: JobQueuePort,
    private readonly jobs: JobRepositoryPort,
  ) {}

  async execute(request: JobRequestType): Promise<{ jobId: string }> {
    const jobId = randomUUID();
    const job = this.queued(jobId, request);
    await this.jobs.save(job);

    try {
      await this.publish(jobId, request);
    } catch (error: unknown) {
      await this.jobs.save(
        job.failed(
          formatFailureReason(`Could not be queued: ${errorMessage(error)}`),
          false,
          new Date(),
        ),
      );
      throw error;
    }

    return { jobId };
  }

  private queued(jobId: string, request: JobRequestType): JobEntity {
    switch (request.kind) {
      case 'proxy_fetch':
        return JobEntity.queued(
          jobId,
          request.kind,
          request.source,
          null,
          new Date(),
          request.requestedBy,
        );
      case 'handbook_fetch':
        return JobEntity.queued(
          jobId,
          request.kind,
          request.handbook,
          null,
          new Date(),
          request.requestedBy,
        );
      case 'price_fetch':
        return JobEntity.queued(
          jobId,
          request.kind,
          request.subject,
          request.products.length,
          new Date(),
          request.requestedBy,
        );
    }
  }

  private publish(jobId: string, request: JobRequestType): Promise<void> {
    switch (request.kind) {
      case 'proxy_fetch':
        return this.queue.enqueueProxyFetch({
          jobId,
          source: request.source,
          maxCandidates: request.maxCandidates,
          recheck: request.recheck,
          probeTimeoutMs: request.probeTimeoutMs,
        });
      case 'handbook_fetch':
        return this.queue.enqueueHandbookFetch({
          jobId,
          handbook: request.handbook,
          proxies: request.proxies,
        });
      case 'price_fetch':
        return this.queue.enqueuePriceFetch({
          jobId,
          routes: request.routes,
          products: request.products,
          timeoutMs: request.timeoutMs,
          ...(request.delayMs === undefined ? {} : { delayMs: request.delayMs }),
        });
    }
  }
}
