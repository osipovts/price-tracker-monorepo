import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { MarketplaceType } from 'product-reference';

import { SearchCitiesUseCase } from '../application/search-cities.use-case.js';
import {
  cityListResponseSchema,
  type CityListResponseType,
  cityMarketplaceParamSchema,
  cityResponseOf,
  citySearchQuerySchema,
  type CitySearchQueryType,
} from './city.type.js';

@ApiBearerAuth()
@ApiTags('marketplaces')
@Controller('marketplaces')
export class CitiesController {
  constructor(@Inject(SearchCitiesUseCase) private readonly searchCities: SearchCitiesUseCase) {}

  @Get(':marketplace/cities')
  @ApiOperation({
    summary: 'Search the cities of a marketplace whose prices depend on the city',
    description:
      'The cities the hub has read of the marketplace, the ones whose names begin with the query first. Empty until the first read of the handbook is done.',
  })
  @ApiOkResponse({ standardSchema: cityListResponseSchema })
  @ApiNotFoundResponse({ description: 'The prices of the marketplace do not depend on the city' })
  async list(
    @Param('marketplace', { schema: cityMarketplaceParamSchema }) marketplace: MarketplaceType,
    @Query({ schema: citySearchQuerySchema }) query: CitySearchQueryType,
  ): Promise<CityListResponseType> {
    return { items: (await this.searchCities.execute(marketplace, query)).map(cityResponseOf) };
  }
}
