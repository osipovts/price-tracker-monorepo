import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { handbookSchema, type HandbookType } from 'queue-contract';

import {
  jobAcceptedResponseSchema,
  type JobAcceptedResponseType,
} from '../../shared/presentation/job-accepted.type.js';
import { toPageResponse } from '../../shared/presentation/pagination-query.type.js';
import { findIdentity } from '../../shared/presentation/request-identity.type.js';
import { routeAccess } from '../../shared/presentation/route-access.type.js';
import { ListHandbookCitiesUseCase } from '../application/list-handbook-cities.use-case.js';
import { RefreshHandbookUseCase } from '../application/refresh-handbook.use-case.js';
import {
  cityResponseOf,
  handbookCitiesQuerySchema,
  type HandbookCitiesQueryType,
  handbookCitiesResponseSchema,
  type HandbookCitiesResponseType,
} from './city.type.js';

@ApiBearerAuth()
@ApiTags('handbooks')
@routeAccess('operator')
@Controller('handbooks')
export class HandbooksController {
  constructor(
    @Inject(RefreshHandbookUseCase) private readonly refreshHandbook: RefreshHandbookUseCase,
    @Inject(ListHandbookCitiesUseCase) private readonly listCities: ListHandbookCitiesUseCase,
  ) {}

  @Get(':handbook')
  @ApiOperation({
    summary: 'The cities a handbook keeps, a page of them',
    description:
      'With the time they were read; empty, and never read, until the first read is done.',
  })
  @ApiOkResponse({ standardSchema: handbookCitiesResponseSchema })
  async list(
    @Param('handbook', { schema: handbookSchema }) handbook: HandbookType,
    @Query({ schema: handbookCitiesQuerySchema }) query: HandbookCitiesQueryType,
  ): Promise<HandbookCitiesResponseType> {
    const { fetchedAt, page } = await this.listCities.execute(handbook, query);

    return {
      ...toPageResponse(page, query, cityResponseOf),
      fetchedAt: fetchedAt?.toISOString() ?? null,
    };
  }

  @Post(':handbook/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue a read of a handbook',
    description:
      'A worker reads the handbook through the best proxies and the hub keeps it. The hub asks for it by itself when it was never read, and every week.',
  })
  @ApiAcceptedResponse({ standardSchema: jobAcceptedResponseSchema })
  refresh(
    @Param('handbook', { schema: handbookSchema }) handbook: HandbookType,
    @Req() request: Request,
  ): Promise<JobAcceptedResponseType> {
    // An administrator who asks follows the job; the operator with the key has no user.
    return this.refreshHandbook.execute(handbook, findIdentity(request)?.userId ?? null);
  }
}
