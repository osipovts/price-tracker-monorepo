import {
  type PageInterface,
  pageOf,
  type PaginationInterface,
} from '../../shared/application/page.interface.js';
import type {
  JobActivityInterface,
  JobCountsType,
  JobFilterInterface,
  JobHourInterface,
  JobKindCountsInterface,
  JobRepositoryPort,
  UnfinishedJobCountsInterface,
} from '../application/job-repository.port.js';
import { type JobEntity, jobKinds, type JobKindType } from '../domain/job.entity.js';

const hourMs = 3_600_000;

function noJobs(): JobCountsType {
  return { queued: 0, running: 0, retrying: 0, completed: 0, failed: 0 };
}

export class InMemoryJobRepositoryAdapter implements JobRepositoryPort {
  private readonly jobs = new Map<string, JobEntity>();

  save(job: JobEntity): Promise<void> {
    this.jobs.set(job.snapshot.id, job);

    return Promise.resolve();
  }

  activity(kind: JobKindType, activeSince: Date): Promise<JobActivityInterface> {
    const ofKind = Array.from(this.jobs.values()).filter(
      ({ snapshot }): boolean => snapshot.kind === kind,
    );
    const finished = ofKind.flatMap(({ snapshot }): Date[] =>
      snapshot.finishedAt === null ? [] : [snapshot.finishedAt],
    );

    return Promise.resolve({
      active: ofKind.some((job): boolean => !job.finished && job.snapshot.createdAt >= activeSince),
      lastFinishedAt:
        finished.length === 0 ? null : new Date(Math.max(...finished.map((at) => at.getTime()))),
    });
  }

  countByKind(since: Date): Promise<JobKindCountsInterface[]> {
    const counts = jobKinds.map((kind): JobKindCountsInterface => ({ kind, ...noJobs() }));
    const ofKind = (kind: JobKindType): JobKindCountsInterface | undefined =>
      counts.find((each): boolean => each.kind === kind);
    for (const { snapshot } of this.jobs.values()) {
      const kind = ofKind(snapshot.kind);
      if (kind !== undefined && snapshot.createdAt >= since) kind[snapshot.status] += 1;
    }

    return Promise.resolve(counts);
  }

  countUnfinished(lostBefore: Date): Promise<UnfinishedJobCountsInterface> {
    const counts: UnfinishedJobCountsInterface = { queued: 0, running: 0, retrying: 0, lost: 0 };
    for (const { snapshot } of this.jobs.values()) {
      const { status, createdAt } = snapshot;
      if (status === 'completed' || status === 'failed') continue;

      if (createdAt < lostBefore) counts.lost += 1;
      else counts[status] += 1;
    }

    return Promise.resolve(counts);
  }

  countFinishedByHour(kind: JobKindType, since: Date): Promise<JobHourInterface[]> {
    const hours = new Map<number, JobHourInterface>();
    for (const { snapshot } of this.jobs.values()) {
      const { finishedAt, status } = snapshot;
      if (snapshot.kind !== kind || finishedAt === null || finishedAt < since) continue;
      if (status !== 'completed' && status !== 'failed') continue;

      const start = Math.floor(finishedAt.getTime() / hourMs) * hourMs;
      const hour = hours.get(start) ?? { hour: new Date(start), completed: 0, failed: 0 };
      hour[status] += 1;
      hours.set(start, hour);
    }

    return Promise.resolve(
      [...hours.values()].toSorted((a, b): number => a.hour.getTime() - b.hour.getTime()),
    );
  }

  findById(id: string): Promise<JobEntity | null> {
    return Promise.resolve(this.jobs.get(id) ?? null);
  }

  list(
    filter: JobFilterInterface,
    pagination: PaginationInterface,
  ): Promise<PageInterface<JobEntity>> {
    const matching = Array.from(this.jobs.values())
      .filter(
        (job): boolean =>
          (filter.kind === undefined || job.snapshot.kind === filter.kind) &&
          (filter.statuses === undefined || filter.statuses.includes(job.snapshot.status)),
      )
      .toSorted((a, b): number => b.snapshot.createdAt.getTime() - a.snapshot.createdAt.getTime());

    return Promise.resolve(pageOf(matching, pagination));
  }
}
