import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { MarketplaceType } from 'product-reference';

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
import { SetMarketplaceDisabledUseCase } from '../application/set-marketplace-disabled.use-case.js';
import { priceHistoryResponseSchema, type PriceHistoryResponseType } from './price-history.type.js';
import {
  marketplaceDisabledBodySchema,
  type MarketplaceDisabledBodyType,
  marketplaceParamSchema,
  productIdParamSchema,
} from './product.type.js';
import {
  productGroupDetailSchema,
  type ProductGroupDetailType,
  productGroupIdParamSchema,
} from './product-group.type.js';
import { toObservation, toProduct, toProductGroupDetail } from './product-presenter.type.js';

/** Admin endpoints owned by the product context. */
@ApiTags('admin')
@routeAccess('admin')
@Controller('admin')
export class AdminProductsController {
  constructor(
    @Inject(GetProductGroupUseCase) private readonly getGroup: GetProductGroupUseCase,
    @Inject(ListPriceHistoryUseCase) private readonly listHistory: ListPriceHistoryUseCase,
    @Inject(GetProductThumbnailUrlUseCase)
    private readonly thumbnailUrl: GetProductThumbnailUrlUseCase,
    @Inject(SetMarketplaceDisabledUseCase)
    private readonly setMarketplaceDisabledUseCase: SetMarketplaceDisabledUseCase,
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

  @Patch('marketplaces/:marketplace')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Turn link intake for a marketplace off or on',
    description:
      'A marketplace that is off refuses new links; products already tracked keep reading. For administrators.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ description: 'The user is not an administrator' })
  async setMarketplaceDisabled(
    @Param('marketplace', { schema: marketplaceParamSchema }) marketplace: MarketplaceType,
    @Body({ schema: marketplaceDisabledBodySchema }) body: MarketplaceDisabledBodyType,
  ): Promise<void> {
    await this.setMarketplaceDisabledUseCase.execute(marketplace, body.disabled);
  }
}
