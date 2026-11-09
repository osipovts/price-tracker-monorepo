import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import { type JobKindType, jobLostAfterMs } from '../domain/job.entity.js';
import type { JobActivityInterface, JobRepositoryPort } from './job-repository.port.js';

/** Tells what the jobs of a kind are doing: whether one is on its way, and when the last one ended. */
export class GetJobActivityUseCase {
  constructor(
    private readonly jobs: JobRepositoryPort,
    private readonly clock: ClockPort = systemClock,
  ) {}

  execute(kind: JobKindType): Promise<JobActivityInterface> {
    return this.jobs.activity(kind, new Date(this.clock.now().getTime() - jobLostAfterMs));
  }
}
