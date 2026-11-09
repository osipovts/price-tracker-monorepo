import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  findLastGroupCheck,
  GetProductThumbnailUrlUseCase,
  productStaleAfterMs,
} from '../../product/application/index.js';
import { toPageResponse } from '../../shared/presentation/pagination-query.type.js';
import { routeAccess } from '../../shared/presentation/route-access.type.js';
import { GetDashboardUseCase } from '../application/get-dashboard.use-case.js';
import {
  type JobRecordInterface,
  ListJobRecordsUseCase,
} from '../application/list-job-records.use-case.js';
import {
  ListTrackedGroupsUseCase,
  type TrackedGroupInterface,
} from '../application/list-tracked-groups.use-case.js';
import { dashboardResponseSchema, type DashboardResponseType } from './dashboard.type.js';
import {
  jobRecordListQuerySchema,
  type JobRecordListQueryType,
  jobRecordListResponseSchema,
  type JobRecordListResponseType,
  type JobRecordType,
} from './job-record.type.js';
import {
  trackedGroupListQuerySchema,
  type TrackedGroupListQueryType,
  trackedGroupListResponseSchema,
  type TrackedGroupListResponseType,
  type TrackedGroupType,
} from './tracked-group.type.js';

function toJobRecord({ job, lost, product }: JobRecordInterface): JobRecordType {
  const { snapshot } = job;

  return {
    id: snapshot.id,
    kind: snapshot.kind,
    subject: snapshot.subject,
    status: snapshot.status,
    percent: job.percent,
    processed: snapshot.processed,
    total: snapshot.total,
    succeeded: snapshot.succeeded,
    error: snapshot.error,
    createdAt: snapshot.createdAt.toISOString(),
    startedAt: snapshot.startedAt?.toISOString() ?? null,
    finishedAt: snapshot.finishedAt?.toISOString() ?? null,
    lost,
    product,
  };
}

@ApiTags('admin')
@routeAccess('admin')
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(GetDashboardUseCase) private readonly getDashboard: GetDashboardUseCase,
    @Inject(ListTrackedGroupsUseCase) private readonly listGroups: ListTrackedGroupsUseCase,
    @Inject(ListJobRecordsUseCase) private readonly listJobs: ListJobRecordsUseCase,
    @Inject(GetProductThumbnailUrlUseCase)
    private readonly thumbnailUrl: GetProductThumbnailUrlUseCase,
  ) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'The figures of the hub on one page',
    description:
      'How the prices are read by marketplace and by the hour, the proxies the reads may take, the jobs and the users. For administrators.',
  })
  @ApiOkResponse({ standardSchema: dashboardResponseSchema })
  @ApiForbiddenResponse({ description: 'The user is not an administrator' })
  async dashboard(): Promise<DashboardResponseType> {
    const { generatedAt, users, products, proxies, jobs } = await this.getDashboard.execute();

    return {
      generatedAt: generatedAt.toISOString(),
      users,
      products: {
        ...products,
        staleAfterMs: productStaleAfterMs,
        marketplaces: products.marketplaces.map((reads) => ({
          ...reads,
          lastReadAt: reads.lastReadAt?.toISOString() ?? null,
        })),
        readsByHour: products.readsByHour.map((hour) => ({
          ...hour,
          hour: hour.hour.toISOString(),
        })),
      },
      proxies: { ...proxies, lastCheckedAt: proxies.lastCheckedAt?.toISOString() ?? null },
      jobs: {
        lastDay: jobs.lastDay,
        unfinished: jobs.unfinished,
        priceJobsByHour: jobs.priceJobsByHour.map((hour) => ({
          ...hour,
          hour: hour.hour.toISOString(),
        })),
        recentFailures: jobs.recentFailures.map((failure) => ({
          ...failure,
          finishedAt: failure.finishedAt?.toISOString() ?? null,
        })),
      },
    };
  }

  @Get('product-groups')
  @ApiOperation({
    summary: 'The product groups of every user, the newest first',
    description:
      'Each with the email of its owner. `GET /admin/product-groups/{id}` shows one as its owner sees it. For administrators.',
  })
  @ApiOkResponse({ standardSchema: trackedGroupListResponseSchema })
  @ApiForbiddenResponse({ description: 'The user is not an administrator' })
  async groups(
    @Query({ schema: trackedGroupListQuerySchema }) query: TrackedGroupListQueryType,
  ): Promise<TrackedGroupListResponseType> {
    const page = await this.listGroups.execute(query);

    return {
      items: await Promise.all(page.items.map((group) => this.toTrackedGroup(group))),
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
    };
  }

  @Get('jobs')
  @ApiOperation({
    summary: 'The jobs, the newest first, with the product a price read is of',
    description: 'For administrators.',
  })
  @ApiOkResponse({ standardSchema: jobRecordListResponseSchema })
  @ApiForbiddenResponse({ description: 'The user is not an administrator' })
  async jobs(
    @Query({ schema: jobRecordListQuerySchema }) query: JobRecordListQueryType,
  ): Promise<JobRecordListResponseType> {
    const page = await this.listJobs.execute(
      {
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.state === undefined ? {} : { state: query.state }),
      },
      query,
    );

    return toPageResponse(page, query, toJobRecord);
  }

  private async toTrackedGroup({
    view,
    ownerEmail,
  }: TrackedGroupInterface): Promise<TrackedGroupType> {
    const snapshots = view.products.map(({ product }) => product.snapshot);
    const lastCheck = findLastGroupCheck(snapshots);
    const { current } = view.prices;

    return {
      id: view.group.snapshot.id,
      title: view.title,
      thumbnailUrl: await this.thumbnailUrl.execute(view.thumbnailKey),
      ownerEmail,
      createdAt: view.group.snapshot.createdAt.toISOString(),
      marketplaces: snapshots.map(({ marketplace }): string => marketplace),
      lastCheck:
        lastCheck === null
          ? null
          : { marketplace: lastCheck.marketplace, checkedAt: lastCheck.checkedAt.toISOString() },
      current:
        current === null
          ? null
          : {
              marketplace: current.marketplace,
              amountMinor: current.amountMinor,
              observedAt: current.observedAt.toISOString(),
            },
    };
  }
}
