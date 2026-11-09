import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import { jobLostAfterMs } from '../domain/job.entity.js';
import type {
  JobHourInterface,
  JobKindCountsInterface,
  JobRepositoryPort,
  UnfinishedJobCountsInterface,
} from './job-repository.port.js';

export interface JobStatsInterface {
  /** The jobs created in the last day, by kind and status. */
  lastDay: JobKindCountsInterface[];
  /** The jobs that are not done now. */
  unfinished: UnfinishedJobCountsInterface;
  /** The price reads that ended in each hour of the last day, the oldest first. */
  priceJobsByHour: JobHourInterface[];
}

const day = 24 * 60 * 60_000;

export class GetJobStatsUseCase {
  constructor(
    private readonly jobs: JobRepositoryPort,
    private readonly clock: ClockPort = systemClock,
  ) {}

  async execute(): Promise<JobStatsInterface> {
    const now = this.clock.now().getTime();
    const dayAgo = new Date(now - day);
    const [lastDay, unfinished, priceJobsByHour] = await Promise.all([
      this.jobs.countByKind(dayAgo),
      this.jobs.countUnfinished(new Date(now - jobLostAfterMs)),
      this.jobs.countFinishedByHour('price_fetch', dayAgo),
    ]);

    return { lastDay, unfinished, priceJobsByHour };
  }
}
