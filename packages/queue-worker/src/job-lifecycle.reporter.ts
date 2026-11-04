import { errorMessage, type LoggerPort } from 'logger';
import type { JobLifecycleType } from 'queue-contract';
import { z } from 'zod';

import type { QueueMessageParser } from './queue-message.parser.js';

/** How long a reported reason of a failure may be. */
export const maxReasonLength = 200;

/** Reports the start and the end of a job, whatever work the job does. */
export class JobLifecycleReporter {
  constructor(
    private readonly publish: (message: JobLifecycleType) => Promise<void>,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Parses a job. One that is malformed fails for good, and the hub is told so when the message says
   * whose job it is: otherwise the job waits for a worker that will never answer.
   */
  async parse<OutputType>(
    messages: QueueMessageParser,
    schema: z.ZodType<OutputType>,
    data: unknown,
    description: string,
  ): Promise<OutputType> {
    try {
      return messages.parse(schema, data, description);
    } catch (error: unknown) {
      const jobId = z.object({ jobId: z.uuid() }).safeParse(data);
      if (jobId.success) {
        await this.publish({
          type: 'job_failed',
          jobId: jobId.data.jobId,
          reason: errorMessage(error).slice(0, maxReasonLength),
          willRetry: false,
        }).catch((publishError: unknown): void => {
          this.logger.error(
            `Could not report the malformed job ${jobId.data.jobId}: ${errorMessage(publishError)}`,
          );
        });
      }
      throw error;
    }
  }

  /** Runs the job between its start and end reports; a failure is reported and rethrown. */
  async run(jobId: string, willRetry: boolean, body: () => Promise<void>): Promise<void> {
    const startedAt = performance.now();
    await this.publish({ type: 'job_started', jobId });

    try {
      await body();
    } catch (error: unknown) {
      const reason = errorMessage(error);
      this.logger.error(`Job ${jobId} failed (${willRetry ? 'will retry' : 'final'}): ${reason}`);
      await this.publish({
        type: 'job_failed',
        jobId,
        reason: reason.slice(0, maxReasonLength),
        willRetry,
      }).catch((publishError: unknown): void => {
        this.logger.error(
          `Could not report the failure of job ${jobId}: ${errorMessage(publishError)}`,
        );
      });
      throw error;
    }

    this.logger.info(
      `Job ${jobId} done in ${String(Math.round(performance.now() - startedAt))} ms`,
    );
    await this.publish({ type: 'job_done', jobId });
  }
}
