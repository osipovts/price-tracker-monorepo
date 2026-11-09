import type {
  PageInterface,
  PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { JobEntity, JobKindType, JobStatusType } from '../domain/job.entity.js';

export const JOB_REPOSITORY = Symbol('JobRepositoryPort');

export interface JobFilterInterface {
  kind?: JobKindType;
  /** The jobs in any of the statuses; in every status when omitted. */
  statuses?: readonly JobStatusType[];
}

export type JobCountsType = Record<JobStatusType, number>;

/** How many jobs of a kind are in each status. */
export interface JobKindCountsInterface extends JobCountsType {
  kind: JobKindType;
}

/** The jobs that are not done: the ones on their way by status, and apart from them the lost ones. */
export interface UnfinishedJobCountsInterface {
  queued: number;
  running: number;
  retrying: number;
  /** Created before the time given and still not done. */
  lost: number;
}

/** How many jobs ended in an hour, and how. */
export interface JobHourInterface {
  /** The start of the hour. */
  hour: Date;
  completed: number;
  failed: number;
}

export interface JobActivityInterface {
  /** Whether a job of the kind, created since the given time, is queued, running or waiting for a retry. */
  active: boolean;
  /** When the latest job of the kind ended, completed or failed; null when none has. */
  lastFinishedAt: Date | null;
}

export interface JobRepositoryPort {
  /** What the jobs of the kind are doing; a job created before `activeSince` is taken for lost. */
  activity(kind: JobKindType, activeSince: Date): Promise<JobActivityInterface>;
  /** How many jobs created since the time are of each kind and in each status, in the order of the kinds. */
  countByKind(since: Date): Promise<JobKindCountsInterface[]>;
  /** The jobs that are not done; the ones created before `lostBefore` are counted as lost. */
  countUnfinished(lostBefore: Date): Promise<UnfinishedJobCountsInterface>;
  /** The jobs of the kind that ended since the time, by the hour, the oldest first; an hour with none is left out. */
  countFinishedByHour(kind: JobKindType, since: Date): Promise<JobHourInterface[]>;
  save(job: JobEntity): Promise<void>;
  findById(id: string): Promise<JobEntity | null>;
  /** Newest first. */
  list(
    filter: JobFilterInterface,
    pagination: PaginationInterface,
  ): Promise<PageInterface<JobEntity>>;
}
