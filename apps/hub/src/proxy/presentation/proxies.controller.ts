import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { toPageResponse } from '../../shared/presentation/pagination-query.type.js';
import { routeAccess } from '../../shared/presentation/route-access.type.js';
import { AddManualProxyUseCase } from '../application/add-manual-proxy.use-case.js';
import { GetProxyStatsUseCase } from '../application/get-proxy-stats.use-case.js';
import { ListProxiesUseCase } from '../application/list-proxies.use-case.js';
import { SetProxyDisabledUseCase } from '../application/set-proxy-disabled.use-case.js';
import {
  proxyAddBodySchema,
  type ProxyAddBodyType,
  proxyDisabledBodySchema,
  type ProxyDisabledBodyType,
  proxyListQuerySchema,
  type ProxyListQueryType,
  proxyListResponseSchema,
  type ProxyListResponseType,
  proxyServerQuerySchema,
  type ProxyServerQueryType,
  proxyStatsResponseSchema,
  type ProxyStatsResponseType,
} from './proxy-list.type.js';

@ApiBearerAuth()
@ApiTags('proxies')
@routeAccess('operator')
@Controller('proxies')
export class ProxiesController {
  constructor(
    @Inject(ListProxiesUseCase) private readonly listProxies: ListProxiesUseCase,
    @Inject(AddManualProxyUseCase) private readonly addManualProxy: AddManualProxyUseCase,
    @Inject(SetProxyDisabledUseCase) private readonly setDisabled: SetProxyDisabledUseCase,
    @Inject(GetProxyStatsUseCase) private readonly getStats: GetProxyStatsUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List proxies, the best by their checks first',
    description:
      'Each proxy tells how it has done reading the marketplaces it was tried on: the workers report every attempt, and a proxy that a marketplace turned away, or that did not get through, rests for that marketplace.',
  })
  @ApiOkResponse({ standardSchema: proxyListResponseSchema })
  async list(
    @Query({ schema: proxyListQuerySchema }) query: ProxyListQueryType,
  ): Promise<ProxyListResponseType> {
    const page = await this.listProxies.execute(
      {
        ...(query.alive === undefined ? {} : { alive: query.alive === 'true' }),
        ...(query.disabled === undefined ? {} : { disabled: query.disabled === 'true' }),
        ...(query.country === undefined ? {} : { country: query.country }),
        ...(query.source === undefined ? {} : { source: query.source }),
      },
      query,
    );

    return toPageResponse(page, query, ({ proxy, reputations }) => ({
      server: proxy.snapshot.server,
      source: proxy.snapshot.source,
      country: proxy.snapshot.country,
      exitIp: proxy.snapshot.exitIp,
      alive: proxy.snapshot.alive,
      latencyMs: proxy.snapshot.latencyMs,
      successRate: proxy.successRate,
      checksTotal: proxy.snapshot.checksTotal,
      lastCheckedAt: proxy.snapshot.lastCheckedAt.toISOString(),
      disabled: proxy.snapshot.disabledAt !== null,
      reputations: reputations.map(({ snapshot }) => ({
        marketplace: snapshot.marketplace,
        successes: snapshot.successes,
        failures: snapshot.failures,
        failureStreak: snapshot.failureStreak,
        lastOutcome: snapshot.lastOutcome,
        lastAttemptAt: snapshot.lastAttemptAt.toISOString(),
        cooldownUntil: snapshot.cooldownUntil?.toISOString() ?? null,
      })),
    }));
  }

  @Get('stats')
  @ApiOperation({
    summary: 'The proxies in figures',
    description:
      'How many there are, alive and turned off, by source; and how many a read of each marketplace may be given now.',
  })
  @ApiOkResponse({ standardSchema: proxyStatsResponseSchema })
  async stats(): Promise<ProxyStatsResponseType> {
    const stats = await this.getStats.execute();

    return { ...stats, lastCheckedAt: stats.lastCheckedAt?.toISOString() ?? null };
  }

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Add a proxy by hand',
    description:
      'The workers are given the manual proxies before the found ones, whatever their check and exit country. A proxy that is listed already becomes manual. The address may carry `user:password@` for an HTTP(S) proxy: the credentials are kept apart, given to the workers only and never listed.',
  })
  @ApiNoContentResponse()
  async add(@Body({ schema: proxyAddBodySchema }) body: ProxyAddBodyType): Promise<void> {
    await this.addManualProxy.execute(body.server);
  }

  @Patch()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Turn a proxy off or on',
    description:
      'A proxy that is off stays in the list but is not given to the workers, and a check does not turn it on. The server goes in the query: it has slashes.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'The proxy is unknown' })
  async setProxyDisabled(
    @Query({ schema: proxyServerQuerySchema }) query: ProxyServerQueryType,
    @Body({ schema: proxyDisabledBodySchema }) body: ProxyDisabledBodyType,
  ): Promise<void> {
    await this.setDisabled.execute(query.server, body.disabled);
  }
}
