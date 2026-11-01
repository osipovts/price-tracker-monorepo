import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import {
  APP_CONFIG,
  type AppConfigInterface,
} from '../../shared/application/app-config.interface.js';
import {
  paginationQuerySchema,
  type PaginationQueryType,
  toPageResponse,
} from '../../shared/presentation/pagination-query.type.js';
import { requireIdentity } from '../../shared/presentation/request-identity.type.js';
import { AddProductUseCase } from '../application/add-product.use-case.js';
import { GetProductThumbnailUrlUseCase } from '../application/get-product-thumbnail-url.use-case.js';
import { ListPriceHistoryUseCase } from '../application/list-price-history.use-case.js';
import { RemoveProductUseCase } from '../application/remove-product.use-case.js';
import type { TrackedProductEntity } from '../domain/tracked-product.entity.js';
import { priceHistoryResponseSchema, type PriceHistoryResponseType } from './price-history.type.js';
import {
  productAddedSchema,
  type ProductAddedType,
  productCreateBodySchema,
  type ProductCreateBodyType,
  productIdParamSchema,
  type ProductType,
} from './product.type.js';
import { toObservation, toProduct } from './product-presenter.type.js';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    @Inject(AddProductUseCase) private readonly addProduct: AddProductUseCase,
    @Inject(ListPriceHistoryUseCase) private readonly listHistory: ListPriceHistoryUseCase,
    @Inject(RemoveProductUseCase) private readonly removeProduct: RemoveProductUseCase,
    @Inject(GetProductThumbnailUrlUseCase)
    private readonly thumbnailUrl: GetProductThumbnailUrlUseCase,
    @Inject(APP_CONFIG) private readonly config: AppConfigInterface,
  ) {}

  private async present(product: TrackedProductEntity): Promise<ProductType> {
    return toProduct(
      product,
      await this.thumbnailUrl.execute(product.snapshot.thumbnailKey),
      this.config.priceRefreshAfterMs,
    );
  }

  @Post()
  @ApiOperation({
    summary: 'Track a product by its URL, in a group',
    description:
      'Any link to the product page works: it is canonicalized. The users share a product and its ' +
      'price history, each one tracks it for themselves. A product that has no price yet gets the read ' +
      'of its first price queued, which `jobId` names: follow it with `GET /jobs/{jobId}`. The product goes ' +
      'into the group `groupId` names, else into a new group; a product the user tracks stays in its group. ' +
      'A user tracks a limited number of products, a group holds a limited number, and products are added ' +
      'at a limited rate.',
  })
  @ApiCreatedResponse({
    standardSchema: productAddedSchema,
    description: 'The product is tracked now',
  })
  @ApiOkResponse({
    standardSchema: productAddedSchema,
    description: 'The user tracked the product already',
  })
  @ApiBadRequestResponse({
    description: 'Unsupported marketplace or product URL, or a city the marketplace does not have',
  })
  @ApiForbiddenResponse({
    description:
      'The user tracks the most products the hub allows, or the group holds the most it may',
  })
  @ApiNotFoundResponse({ description: "The group is not the user's" })
  @ApiTooManyRequestsResponse({ description: 'The user adds products too fast' })
  async add(
    @Body({ schema: productCreateBodySchema }) body: ProductCreateBodyType,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProductAddedType> {
    const { product, created, jobId, groupId } = await this.addProduct.execute(
      requireIdentity(request).userId,
      body.url,
      body.cityId ?? null,
      body.groupId ?? null,
    );
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);

    return { ...(await this.present(product)), jobId, groupId };
  }

  @Get(':id/prices')
  @ApiOperation({ summary: 'Price history of a product, the newest first' })
  @ApiOkResponse({ standardSchema: priceHistoryResponseSchema })
  @ApiNotFoundResponse({ description: 'The product is not tracked' })
  async prices(
    @Param('id', { schema: productIdParamSchema }) id: string,
    @Query({ schema: paginationQuerySchema }) query: PaginationQueryType,
    @Req() request: Request,
  ): Promise<PriceHistoryResponseType> {
    const { product, page } = await this.listHistory.execute(
      requireIdentity(request).userId,
      id,
      query,
    );

    return {
      product: await this.present(product),
      ...toPageResponse(page, query, toObservation),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Stop tracking a product',
    description:
      'The product is shared: it is deleted with its price history only when nobody tracks it any more.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'The product is not tracked' })
  async remove(
    @Param('id', { schema: productIdParamSchema }) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.removeProduct.execute(requireIdentity(request).userId, id);
  }
}
