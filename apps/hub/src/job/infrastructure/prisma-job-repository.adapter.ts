import { z } from 'zod';

import type { JobRecord as JobRow, PrismaClient } from '../../generated/prisma/client.js';
import {
  type PageInterface,
  pageOffset,
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
import {
  JobEntity,
  jobKinds,
  type JobKindType,
  jobStatuses,
  unfinishedJobStatuses,
} from '../domain/job.entity.js';

const kindSchema = z.enum(jobKinds);
const statusSchema = z.enum(jobStatuses);

const unfinishedStatusSchema = z.enum(unfinishedJobStatuses);
const finishedStatusSchema = z.enum(['completed', 'failed']);

const hourMs = 3_600_000;

function noJobs(): JobCountsType {
  return { queued: 0, running: 0, retrying: 0, completed: 0, failed: 0 };
}

function toEntity(row: JobRow): JobEntity {
  return new JobEntity({
    id: row.id,
    kind: kindSchema.parse(row.kind),
    subject: row.subject,
    requestedBy: row.requestedBy,
    status: statusSchema.parse(row.status),
    processed: row.processed,
    total: row.total,
    succeeded: row.succeeded,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });
}

export class PrismaJobRepositoryAdapter implements JobRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async save(job: JobEntity): Promise<void> {
    const { id, ...data } = job.snapshot;
    await this.prisma.jobRecord.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }

  async activity(kind: JobKindType, activeSince: Date): Promise<JobActivityInterface> {
    const [active, last] = await Promise.all([
      this.prisma.jobRecord.count({
        where: {
          kind,
          status: { in: ['queued', 'running', 'retrying'] },
          createdAt: { gte: activeSince },
        },
      }),
      this.prisma.jobRecord.aggregate({ where: { kind }, _max: { finishedAt: true } }),
    ]);

    return { active: active > 0, lastFinishedAt: last._max.finishedAt };
  }

  async countByKind(since: Date): Promise<JobKindCountsInterface[]> {
    const groups = await this.prisma.jobRecord.groupBy({
      by: ['kind', 'status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const counts = jobKinds.map((kind): JobKindCountsInterface => ({ kind, ...noJobs() }));
    const ofKind = (kind: JobKindType): JobKindCountsInterface | undefined =>
      counts.find((each): boolean => each.kind === kind);
    for (const group of groups) {
      const kind = ofKind(kindSchema.parse(group.kind));
      if (kind !== undefined) kind[statusSchema.parse(group.status)] = group._count._all;
    }

    return counts;
  }

  async countUnfinished(lostBefore: Date): Promise<UnfinishedJobCountsInterface> {
    const unfinished = { in: [...unfinishedJobStatuses] };
    const [groups, lost] = await Promise.all([
      this.prisma.jobRecord.groupBy({
        by: ['status'],
        where: { status: unfinished, createdAt: { gte: lostBefore } },
        _count: { _all: true },
      }),
      this.prisma.jobRecord.count({ where: { status: unfinished, createdAt: { lt: lostBefore } } }),
    ]);
    const counts: UnfinishedJobCountsInterface = { queued: 0, running: 0, retrying: 0, lost };
    for (const group of groups)
      counts[unfinishedStatusSchema.parse(group.status)] = group._count._all;

    return counts;
  }

  async countFinishedByHour(kind: JobKindType, since: Date): Promise<JobHourInterface[]> {
    // A day of jobs is a few thousand rows at most: they are counted here, in UTC hours.
    const rows = await this.prisma.jobRecord.findMany({
      where: { kind, status: { in: ['completed', 'failed'] }, finishedAt: { gte: since } },
      select: { status: true, finishedAt: true },
      orderBy: { finishedAt: 'asc' },
    });
    const hours = new Map<number, JobHourInterface>();
    for (const row of rows) {
      if (row.finishedAt === null) continue;

      const status = finishedStatusSchema.parse(row.status);
      const start = Math.floor(row.finishedAt.getTime() / hourMs) * hourMs;
      const hour = hours.get(start) ?? { hour: new Date(start), completed: 0, failed: 0 };
      hour[status] += 1;
      hours.set(start, hour);
    }

    return [...hours.values()];
  }

  async findById(id: string): Promise<JobEntity | null> {
    const row = await this.prisma.jobRecord.findUnique({ where: { id } });

    return row === null ? null : toEntity(row);
  }

  async list(
    filter: JobFilterInterface,
    pagination: PaginationInterface,
  ): Promise<PageInterface<JobEntity>> {
    const where = {
      ...(filter.kind === undefined ? {} : { kind: filter.kind }),
      ...(filter.statuses === undefined ? {} : { status: { in: [...filter.statuses] } }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.jobRecord.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pageOffset(pagination),
        take: pagination.pageSize,
      }),
      this.prisma.jobRecord.count({ where }),
    ]);

    return { items: rows.map(toEntity), total };
  }
}
