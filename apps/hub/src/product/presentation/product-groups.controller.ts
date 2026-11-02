import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import {
  APP_CONFIG,
  type AppConfigInterface,
} from '../../shared/application/app-config.interface.js';
import {
  paginationQuerySchema,
  type PaginationQueryType,
} from '../../shared/presentation/pagination-query.type.js';
import { requireIdentity } from '../../shared/presentation/request-identity.type.js';
import { CreateProductGroupUseCase } from '../application/create-product-group.use-case.js';
import type { ProductGroupViewInterface } from '../application/describe-product-groups.use-case.js';
import { GetProductGroupUseCase } from '../application/get-product-group.use-case.js';
import { GetProductThumbnailUrlUseCase } from '../application/get-product-thumbnail-url.use-case.js';
import { findLastGroupCheck } from '../application/group-checks.type.js';
import type { GroupPriceInterface } from '../application/group-price-summary.type.js';
import { ListProductGroupsUseCase } from '../application/list-product-groups.use-case.js';
import { RemoveProductGroupUseCase } from '../application/remove-product-group.use-case.js';
import { RenameProductGroupUseCase } from '../application/rename-product-group.use-case.js';
import { SetStatsPeriodUseCase } from '../application/set-stats-period.use-case.js';
import { defaultStatsPeriod } from '../domain/stats-period.type.js';
import {
  productGroupCreateBodySchema,
  type ProductGroupCreateBodyType,
  productGroupDetailSchema,
  type ProductGroupDetailType,
  productGroupIdParamSchema,
  productGroupListResponseSchema,
  type ProductGroupListResponseType,
  productGroupRenameBodySchema,
  type ProductGroupRenameBodyType,
  productGroupSchema,
  type ProductGroupType,
  statsPeriodBodySchema,
  type StatsPeriodBodyType,
} from './product-group.type.js';
import { toObservation, toProduct } from './product-presenter.type.js';

function toPrice(
  price: GroupPriceInterface | null,
): { marketplace: string; amountMinor: number; observedAt: string } | null {
  return price === null
    ? null
    : {
        marketplace: price.marketplace,
        amountMinor: price.amountMinor,
        observedAt: price.observedAt.toISOString(),
      };
}

@ApiTags('product-groups')
@Controller('product-groups')
export class ProductGroupsController {
  constructor(
    @Inject(ListProductGroupsUseCase) private readonly listGroups: ListProductGroupsUseCase,
    @Inject(GetProductGroupUseCase) private readonly getGroup: GetProductGroupUseCase,
    @Inject(CreateProductGroupUseCase) private readonly createGroup: CreateProductGroupUseCase,
    @Inject(RenameProductGroupUseCase) private readonly renameGroup: RenameProductGroupUseCase,
    @Inject(RemoveProductGroupUseCase) private readonly removeGroup: RemoveProductGroupUseCase,
    @Inject(SetStatsPeriodUseCase) private readonly setStatsPeriod: SetStatsPeriodUseCase,
    @Inject(GetProductThumbnailUrlUseCase)
    private readonly thumbnailUrl: GetProductThumbnailUrlUseCase,
    @Inject(APP_CONFIG) private readonly config: AppConfigInterface,
  ) {}

  private async present(view: ProductGroupViewInterface): Promise<ProductGroupType> {
    const { group, prices } = view;
    const lastCheck = findLastGroupCheck(view.products.map(({ product }) => product.snapshot));

    return {
      id: group.snapshot.id,
      title: view.title,
      thumbnailUrl: await this.thumbnailUrl.execute(view.thumbnailKey),
      createdAt: group.snapshot.createdAt.toISOString(),
      productCount: view.products.length,
      lastCheck:
        lastCheck === null
          ? null
          : { marketplace: lastCheck.marketplace, checkedAt: lastCheck.checkedAt.toISOString() },
      current: toPrice(prices.current),
      min: toPrice(prices.min),
      max: toPrice(prices.max),
      highlighted: prices.highlighted,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'List the product groups of the user, the newest first',
    description:
      'A group holds the same item tracked on several marketplaces. The cards show the best price now and the ' +
      'lowest and the highest one of `statsPeriod`.',
  })
  @ApiOkResponse({ standardSchema: productGroupListResponseSchema })
  async list(
    @Query({ schema: paginationQuerySchema }) query: PaginationQueryType,
    @Req() request: Request,
  ): Promise<ProductGroupListResponseType> {
    const page = await this.listGroups.execute(requireIdentity(request).userId, query);

    return {
      items: await Promise.all(page.items.map((view) => this.present(view))),
      page: query.page,
      pageSize: query.pageSize,
      total: page.total,
      statsPeriod: page.statsPeriod,
    };
  }

  @Post()
  @ApiOperation({
    summary: 'Make an empty group',
    description: 'A group made by adding a product (`POST /products`) is made there.',
  })
  @ApiCreatedResponse({ standardSchema: productGroupSchema })
  async create(
    @Body({ schema: productGroupCreateBodySchema }) body: ProductGroupCreateBodyType,
    @Req() request: Request,
  ): Promise<ProductGroupType> {
    const group = await this.createGroup.execute(
      requireIdentity(request).userId,
      body.title ?? null,
    );

    return this.present({
      group,
      title: group.snapshot.title,
      thumbnailKey: null,
      products: [],
      prices: { current: null, min: null, max: null, highlighted: false },
      statsPeriod: defaultStatsPeriod,
    });
  }

  @Put('stats-period')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Choose the period of the lowest and the highest price on the cards',
    description: 'Kept for the user, so that it is the same on every device.',
  })
  @ApiNoContentResponse()
  async chooseStatsPeriod(
    @Body({ schema: statsPeriodBodySchema }) body: StatsPeriodBodyType,
    @Req() request: Request,
  ): Promise<void> {
    await this.setStatsPeriod.execute(requireIdentity(request).userId, body.statsPeriod);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A product group with its products, each with its newest price' })
  @ApiOkResponse({ standardSchema: productGroupDetailSchema })
  @ApiNotFoundResponse({ description: "The group is not the user's" })
  async get(
    @Param('id', { schema: productGroupIdParamSchema }) id: string,
    @Req() request: Request,
  ): Promise<ProductGroupDetailType> {
    const { userId } = requireIdentity(request);
    const view = await this.getGroup.execute(userId, id);

    return {
      ...(await this.present(view)),
      statsPeriod: view.statsPeriod,
      products: await Promise.all(
        view.products.map(async ({ product, latest }) => ({
          ...toProduct(
            product,
            await this.thumbnailUrl.execute(product.snapshot.thumbnailKey),
            this.config.priceRefreshAfterMs,
          ),
          latest: latest === null ? null : toObservation(latest),
        })),
      ),
    };
  }

  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Rename a product group' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: "The group is not the user's" })
  async rename(
    @Param('id', { schema: productGroupIdParamSchema }) id: string,
    @Body({ schema: productGroupRenameBodySchema }) body: ProductGroupRenameBodyType,
    @Req() request: Request,
  ): Promise<void> {
    await this.renameGroup.execute(requireIdentity(request).userId, id, body.title);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a product group and stop tracking its products',
    description:
      'The products are shared: each is deleted with its price history only when nobody tracks it any more.',
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: "The group is not the user's" })
  async remove(
    @Param('id', { schema: productGroupIdParamSchema }) id: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.removeGroup.execute(requireIdentity(request).userId, id);
  }
}
