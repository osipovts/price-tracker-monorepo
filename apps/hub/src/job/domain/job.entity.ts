export const jobKinds = ['proxy_fetch', 'price_fetch', 'handbook_fetch'] as const;

export type JobKindType = (typeof jobKinds)[number];

export const jobStatuses = ['queued', 'running', 'retrying', 'completed', 'failed'] as const;

export type JobStatusType = (typeof jobStatuses)[number];

/** The statuses of a job that is not done yet. */
export const unfinishedJobStatuses = [
  'queued',
  'running',
  'retrying',
] as const satisfies JobStatusType[];

/** A job that is still not done after this long is taken for lost: it does not hold up what waits for it. */
export const jobLostAfterMs = 60 * 60_000;

export interface JobInterface {
  id: string;
  kind: JobKindType;
  /** The proxy source of a proxy job, the product id of a price job, or the handbook of a handbook job. */
  subject: string;
  /** The user who asked for the job; null for the jobs of the operator. Only they may read it. */
  requestedBy: string | null;
  status: JobStatusType;
  processed: number;
  /** Null until the worker knows how much work there is. */
  total: number | null;
  succeeded: number;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface JobProgressInterface {
  processed: number;
  total: number;
  succeeded: number;
}

/** A job that has completed or failed for good does not change any more. */
export class JobEntity {
  constructor(readonly snapshot: JobInterface) {}

  static queued(
    id: string,
    kind: JobKindType,
    subject: string,
    total: number | null,
    createdAt: Date,
    requestedBy: string | null,
  ): JobEntity {
    return new JobEntity({
      id,
      kind,
      subject,
      requestedBy,
      status: 'queued',
      processed: 0,
      total,
      succeeded: 0,
      error: null,
      createdAt,
      startedAt: null,
      finishedAt: null,
    });
  }

  /** Completion of the job, from 0 to 100. */
  get percent(): number {
    if (this.snapshot.status === 'completed') return 100;

    const { processed, total } = this.snapshot;

    return total === null || total === 0 ? 0 : Math.floor((processed / total) * 100);
  }

  get finished(): boolean {
    return this.snapshot.status === 'completed' || this.snapshot.status === 'failed';
  }

  /** Not done long after it was queued: the worker that had it is likely gone. */
  isLost(now: Date): boolean {
    return !this.finished && now.getTime() - this.snapshot.createdAt.getTime() >= jobLostAfterMs;
  }

  started(at: Date): JobEntity {
    if (this.finished) return this;

    return new JobEntity({
      ...this.snapshot,
      status: 'running',
      error: null,
      startedAt: this.snapshot.startedAt ?? at,
    });
  }

  progressed(progress: JobProgressInterface, at: Date): JobEntity {
    if (this.finished) return this;

    return new JobEntity({
      ...this.snapshot,
      ...progress,
      status: 'running',
      startedAt: this.snapshot.startedAt ?? at,
    });
  }

  completed(at: Date): JobEntity {
    if (this.finished) return this;

    return new JobEntity({
      ...this.snapshot,
      status: 'completed',
      error: null,
      startedAt: this.snapshot.startedAt ?? at,
      finishedAt: at,
    });
  }

  failed(reason: string, willRetry: boolean, at: Date): JobEntity {
    if (this.finished) return this;

    return new JobEntity({
      ...this.snapshot,
      status: willRetry ? 'retrying' : 'failed',
      error: reason,
      finishedAt: willRetry ? null : at,
    });
  }
}
