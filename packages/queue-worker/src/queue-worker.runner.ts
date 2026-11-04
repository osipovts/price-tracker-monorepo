import { Queue, Worker } from 'bullmq';
import { errorMessage, type LoggerPort } from 'logger';
import type { JobLifecycleType } from 'queue-contract';

import { closeWithin } from './close-within.type.js';
import { maxReasonLength } from './job-lifecycle.reporter.js';

export interface QueueWorkerSettingsInterface {
  redisUrl: string;
  jobsQueue: string;
  /** Where the results are published; none for a worker that returns them to the one who waits. */
  resultsQueue?: string;
  /** Jobs handled in parallel. */
  concurrency: number;
  /** How long a stop lets the jobs in progress run before it asks them to stop. */
  cancelAfterMs?: number;
}

/** Shorter than the 70 s the containers are given to stop in. */
const defaultCancelAfterMs = 50_000;

/**
 * Handles a raw job message; `willRetry` tells whether the queue delivers the job again after a failure.
 * `retryWith` replaces the data the queue gives the job when it delivers it again.
 * What it returns is the return value of the job.
 */
export type JobHandlerType = (
  data: unknown,
  signal: AbortSignal,
  willRetry: boolean,
  retryWith: (data: unknown) => Promise<void>,
) => Promise<unknown>;

/** Takes the jobs of one queue and publishes their results to another one. */
export class QueueWorkerRunner<ResultType extends { type: string; jobId: string }> {
  private readonly connection: { url: string };
  private readonly results: Queue | null;
  private worker: Worker | null = null;

  constructor(
    private readonly settings: QueueWorkerSettingsInterface,
    private readonly logger: LoggerPort,
  ) {
    this.connection = { url: settings.redisUrl };
    this.results =
      settings.resultsQueue === undefined
        ? null
        : new Queue(settings.resultsQueue, {
            connection: this.connection,
            defaultJobOptions: { removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } },
          });
    this.results?.on('error', (error): void => {
      this.logger.error(`Results queue error: ${error.message}`);
    });
  }

  async publish(message: ResultType): Promise<void> {
    if (this.results === null) throw new Error('The worker has no results queue');

    this.logger.verbose(`Publishing ${message.type} of job ${message.jobId}`);
    await this.results.add(message.type, message);
  }

  start(handle: JobHandlerType): void {
    this.worker = new Worker(
      this.settings.jobsQueue,
      async (job, _token, signal): Promise<unknown> => {
        // The queue redelivers a failed job until its attempts are used up.
        const willRetry = job.attemptsMade + 1 < (job.opts.attempts ?? 1);
        this.logger.debug(`Took job ${job.id ?? '?'} (attempt ${String(job.attemptsMade + 1)})`);

        return handle(
          job.data,
          signal ?? new AbortController().signal,
          willRetry,
          (data): Promise<void> => job.updateData(data),
        );
      },
      { connection: this.connection, concurrency: this.settings.concurrency },
    );

    this.worker.on('error', (error): void => {
      this.logger.error(`Worker error: ${error.message}`);
    });
    this.worker.on('failed', (job, error): void => {
      this.logger.warn(`Queue job ${job?.id ?? '?'} failed: ${error.message}`);
      // Only a job that has failed for good has an end.
      if (job?.id !== undefined && job.finishedOn !== undefined) {
        void this.reportFailure(job.id, error.message);
      }
    });

    this.logger.info(
      `Waiting for jobs on ${this.settings.jobsQueue} (redis ${this.settings.redisUrl.replace(/\/\/[^@]*@/, '//***@')})`,
    );
  }

  /**
   * Tells that the queue has failed a job for good. The queue fails a job that stalled too often (its
   * worker died) before the handler sees it, so no one else tells it; a failure the handler has told
   * already is told twice, which changes nothing.
   */
  private async reportFailure(jobId: string, reason: string): Promise<void> {
    if (this.results === null) return;

    const message: JobLifecycleType = {
      type: 'job_failed',
      jobId,
      reason: reason.slice(0, maxReasonLength),
      willRetry: false,
    };
    try {
      await this.results.add(message.type, message);
    } catch (error: unknown) {
      this.logger.error(`Could not report the failure of job ${jobId}: ${errorMessage(error)}`);
    }
  }

  /**
   * Stops taking jobs, lets the ones in progress finish, and closes the queues. A job that has not
   * finished by `cancelAfterMs` is asked to stop: it fails with what it has read, and is delivered again.
   */
  async close(): Promise<void> {
    const worker = this.worker;
    if (worker !== null) {
      await closeWithin(
        worker.close(),
        (): void => {
          this.logger.warn('The jobs in progress are asked to stop');
          worker.cancelAllJobs('shutdown');
        },
        this.settings.cancelAfterMs ?? defaultCancelAfterMs,
      );
    }
    await this.results?.close();
  }

  /** Stops taking jobs on SIGINT or SIGTERM, then releases the other resources with `cleanup`. */
  stopOnSignals(cleanup: () => Promise<void> = (): Promise<void> => Promise.resolve()): void {
    const stop = async (): Promise<void> => {
      this.logger.info('Shutting down');
      await this.close();
      await cleanup();
    };

    process.once('SIGINT', (): void => {
      void stop();
    });
    process.once('SIGTERM', (): void => {
      void stop();
    });
  }
}
