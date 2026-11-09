import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import {
  APP_CONFIG,
  type AppConfigInterface,
} from '../../shared/application/app-config.interface.js';
import {
  paginationQuerySchema,
  type PaginationQueryType,
  toPageResponse,
} from '../../shared/presentation/pagination-query.type.js';
import { routeAccess } from '../../shared/presentation/route-access.type.js';
import { GetProductGroupUseCase } from '../application/get-product-group.use-case.js';
import { GetProductThumbnailUrlUseCase } from '../application/get-product-thumbnail-url.use-case.js';
import { ListPriceHistoryUseCase } from '../application/list-price-history.use-case.js';
import { administratorViewer } from '../application/product-viewer.type.js';
import { priceHistoryResponseSchema, type PriceHistoryResponseType } from './price-history.type.js';
import { productIdParamSchema } from './product.type.js';
import {
  productGroupDetailSchema,
  type ProductGroupDetailType,
  productGroupIdParamSchema,
} from './product-group.type.js';
import { toObservation, toProduct, toProductGroupDetail } from './product-presenter.type.js';

/** The groups and the prices of any user as the user sees them, for an administrator to look at and not to change. */
@ApiTags('admin')
@routeAccess('admin')
@Controller('admin')
export class AdminProductsController {
  constructor(
    @Inject(GetProductGroupUseCase) private readonly getGroup: GetProductGroupUseCase,
    @Inject(ListPriceHistoryUseCase) private readonly listHistory: ListPriceHistoryUseCase,
    @Inject(GetProductThumbnailUrlUseCase)
    private readonly thumbnailUrl: GetProductThumbnailUrlUseCase,
    @Inject(APP_CONFIG) private readonly config: AppConfigInterface,
  ) {}

  @Get('product-groups/:id')
  @ApiOperation({
    summary: 'A product group of any user, as its owner sees it',
    description: 'The same as `GET /product-groups/{id}` for the owner. For administrators.',
  })
  @ApiOkResponse({ standardSchema: productGroupDetailSchema })
  @ApiForbiddenResponse({ description: 'The user is not an administrator' })
  @ApiNotFoundResponse({ description: 'The group is unknown' })
  async group(
    @Param('id', { schema: productGroupIdParamSchema }) id: string,
  ): Promise<ProductGroupDetailType> {
    return toProductGroupDetail(
      await this.getGroup.execute(administratorViewer, id),
      (key) => this.thumbnailUrl.execute(key),
      this.config.priceRefreshAfterMs,
    );
  }

  @Get('products/:id/prices')
  @ApiOperation({
    summary: 'Price history of any tracked product, the newest first',
    description:
      'The same as `GET /products/{id}/prices` for a user who tracks it. For administrators.',
  })
  @ApiOkResponse({ standardSchema: priceHistoryResponseSchema })
  @ApiForbiddenResponse({ description: 'The user is not an administrator' })
  @ApiNotFoundResponse({ description: 'The product is not tracked' })
  async prices(
    @Param('id', { schema: productIdParamSchema }) id: string,
    @Query({ schema: paginationQuerySchema }) query: PaginationQueryType,
  ): Promise<PriceHistoryResponseType> {
    const { product, page } = await this.listHistory.execute(administratorViewer, id, query);

    return {
      product: toProduct(
        product,
        await this.thumbnailUrl.execute(product.snapshot.thumbnailKey),
        this.config.priceRefreshAfterMs,
      ),
      ...toPageResponse(page, query, toObservation),
    };
  }
}
