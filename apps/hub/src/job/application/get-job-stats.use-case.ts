import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import { type JobKindType, jobLostAfterMs } from '../domain/job.entity.js';
import type {
  JobHourInterface,
  JobKindCountsInterface,
  JobRepositoryPort,
  UnfinishedJobCountsInterface,
} from './job-repository.port.js';

export interface JobFailureInterface {
  id: string;
  kind: JobKindType;
  subject: string;
  error: string | null;
  finishedAt: Date | null;
}

export interface JobStatsInterface {
  /** The jobs created in the last day, by kind and status. */
  lastDay: JobKindCountsInterface[];
  /** The jobs that are not done now. */
  unfinished: UnfinishedJobCountsInterface;
  /** The price reads that ended in each hour of the last day, the oldest first. */
  priceJobsByHour: JobHourInterface[];
  /** The latest jobs that failed for good, the newest first. */
  recentFailures: JobFailureInterface[];
}

const failuresShown = 5;

const day = 24 * 60 * 60_000;

export class GetJobStatsUseCase {
  constructor(
    private readonly jobs: JobRepositoryPort,
    private readonly clock: ClockPort = systemClock,
  ) {}

  async execute(): Promise<JobStatsInterface> {
    const now = this.clock.now().getTime();
    const dayAgo = new Date(now - day);
    const [lastDay, unfinished, priceJobsByHour, failed] = await Promise.all([
      this.jobs.countByKind(dayAgo),
      this.jobs.countUnfinished(new Date(now - jobLostAfterMs)),
      this.jobs.countFinishedByHour('price_fetch', dayAgo),
      this.jobs.list({ statuses: ['failed'] }, { page: 1, pageSize: failuresShown }),
    ]);

    return {
      lastDay,
      unfinished,
      priceJobsByHour,
      recentFailures: failed.items.map(({ snapshot }): JobFailureInterface => ({
        id: snapshot.id,
        kind: snapshot.kind,
        subject: snapshot.subject,
        error: snapshot.error,
        finishedAt: snapshot.finishedAt,
      })),
    };
  }
}
