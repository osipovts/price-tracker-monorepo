import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { toPageResponse } from '../../shared/presentation/pagination-query.type.js';
import { requireIdentity } from '../../shared/presentation/request-identity.type.js';
import { routeAccess } from '../../shared/presentation/route-access.type.js';
import { GetJobUseCase } from '../application/get-job.use-case.js';
import { ListJobsUseCase } from '../application/list-jobs.use-case.js';
import type { JobEntity } from '../domain/job.entity.js';
import {
  jobIdParamSchema,
  jobListQuerySchema,
  type JobListQueryType,
  jobListResponseSchema,
  type JobListResponseType,
  jobSchema,
  type JobType,
} from './job.type.js';

function toJob(job: JobEntity): JobType {
  const { createdAt, startedAt, finishedAt, ...rest } = job.snapshot;

  return {
    ...rest,
    percent: job.percent,
    createdAt: createdAt.toISOString(),
    startedAt: startedAt?.toISOString() ?? null,
    finishedAt: finishedAt?.toISOString() ?? null,
  };
}

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(
    @Inject(GetJobUseCase) private readonly getJob: GetJobUseCase,
    @Inject(ListJobsUseCase) private readonly listJobs: ListJobsUseCase,
  ) {}

  @Get()
  @routeAccess('operator')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List jobs, the newest first' })
  @ApiOkResponse({ standardSchema: jobListResponseSchema })
  async list(
    @Query({ schema: jobListQuerySchema }) query: JobListQueryType,
  ): Promise<JobListResponseType> {
    const page = await this.listJobs.execute(
      {
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.status === undefined ? {} : { statuses: [query.status] }),
      },
      query,
    );

    return toPageResponse(page, query, toJob);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Status and progress of a job; poll it for a progress bar',
    description: 'Only the user who requested the job can read it.',
  })
  @ApiOkResponse({ standardSchema: jobSchema })
  @ApiNotFoundResponse({ description: "The job is unknown, or is not the user's" })
  async get(
    @Param('id', { schema: jobIdParamSchema }) id: string,
    @Req() request: Request,
  ): Promise<JobType> {
    return toJob(await this.getJob.execute(requireIdentity(request).userId, id));
  }
}
