import { Module } from '@nestjs/common';
import {
  DnsReferenceParser,
  OzonReferenceParser,
  OzonShortLinkParser,
  ResolveProductReferenceUseCase,
} from 'product-reference';

import { PrismaClient } from '../generated/prisma/client.js';
import { FindCityUseCase } from '../handbook/application/index.js';
import { HandbookModule } from '../handbook/handbook.module.js';
import { ScheduleJobUseCase } from '../job/application/index.js';
import { JobModule } from '../job/job.module.js';
import {
  ListBestProxyServersUseCase,
  RecordProxyAttemptsUseCase,
} from '../proxy/application/index.js';
import { ProxyModule } from '../proxy/proxy.module.js';
import { APP_CONFIG, type AppConfigInterface } from '../shared/application/app-config.interface.js';
import { systemClock } from '../shared/application/clock.port.js';
import { LOGGER, type LoggerPort } from '../shared/application/logger.port.js';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../shared/application/object-storage.port.js';
import { RATE_LIMITER, type RateLimiterPort } from '../shared/application/rate-limiter.port.js';
import { PRISMA, PrismaModule } from '../shared/infrastructure/prisma.module.js';
import { AddProductUseCase } from './application/add-product.use-case.js';
import { ChoosePriceRoutesUseCase } from './application/choose-price-routes.use-case.js';
import { CreateProductGroupUseCase } from './application/create-product-group.use-case.js';
import { DescribeProductGroupsUseCase } from './application/describe-product-groups.use-case.js';
import { ExpandProductLinkUseCase } from './application/expand-product-link.use-case.js';
import { GetProductGroupUseCase } from './application/get-product-group.use-case.js';
import { GetProductStatsUseCase } from './application/get-product-stats.use-case.js';
import { GetProductThumbnailUrlUseCase } from './application/get-product-thumbnail-url.use-case.js';
import { IMAGE_DOWNLOADER, type ImageDownloaderPort } from './application/image-downloader.port.js';
import { ListPriceHistoryUseCase } from './application/list-price-history.use-case.js';
import { ListProductGroupsUseCase } from './application/list-product-groups.use-case.js';
import {
  PRICE_OBSERVATION_REPOSITORY,
  type PriceObservationRepositoryPort,
} from './application/price-observation-repository.port.js';
import {
  PRODUCT_GROUP_PREFERENCE_REPOSITORY,
  type ProductGroupPreferenceRepositoryPort,
} from './application/product-group-preference-repository.port.js';
import {
  PRODUCT_GROUP_REPOSITORY,
  type ProductGroupRepositoryPort,
} from './application/product-group-repository.port.js';
import {
  PRODUCT_LINK_EXPANDER,
  type ProductLinkExpanderPort,
} from './application/product-link-expander.port.js';
import { RecordPriceResultUseCase } from './application/record-price-result.use-case.js';
import { RefreshPricesUseCase } from './application/refresh-prices.use-case.js';
import { RemoveProductUseCase } from './application/remove-product.use-case.js';
import { RemoveProductGroupUseCase } from './application/remove-product-group.use-case.js';
import { RemoveUserProductsUseCase } from './application/remove-user-products.use-case.js';
import { RenameProductGroupUseCase } from './application/rename-product-group.use-case.js';
import { RequestPriceObservationUseCase } from './application/request-price-observation.use-case.js';
import { SetStatsPeriodUseCase } from './application/set-stats-period.use-case.js';
import { SpreadPriceJobsUseCase } from './application/spread-price-jobs.use-case.js';
import { StoreProductThumbnailUseCase } from './application/store-product-thumbnail.use-case.js';
import {
  TRACKED_PRODUCT_REPOSITORY,
  type TrackedProductRepositoryPort,
} from './application/tracked-product-repository.port.js';
import { BullmqProductLinkExpanderAdapter } from './infrastructure/bullmq-product-link-expander.adapter.js';
import { HttpImageDownloaderAdapter } from './infrastructure/http-image-downloader.adapter.js';
import { PeriodicPriceRefreshAdapter } from './infrastructure/periodic-price-refresh.adapter.js';
import { PrismaPriceObservationRepositoryAdapter } from './infrastructure/prisma-price-observation-repository.adapter.js';
import { PrismaProductGroupPreferenceRepositoryAdapter } from './infrastructure/prisma-product-group-preference-repository.adapter.js';
import { PrismaProductGroupRepositoryAdapter } from './infrastructure/prisma-product-group-repository.adapter.js';
import { PrismaTrackedProductRepositoryAdapter } from './infrastructure/prisma-tracked-product-repository.adapter.js';
import { PriceResultsConsumer } from './presentation/price-results.consumer.js';
import { ProductGroupsController } from './presentation/product-groups.controller.js';
import { ProductsController } from './presentation/products.controller.js';

@Module({
  imports: [PrismaModule, JobModule, ProxyModule, HandbookModule],
  controllers: [ProductsController, ProductGroupsController],
  providers: [
    {
      provide: TRACKED_PRODUCT_REPOSITORY,
      useFactory: (prisma: PrismaClient): TrackedProductRepositoryPort =>
        new PrismaTrackedProductRepositoryAdapter(prisma),
      inject: [PRISMA],
    },
    {
      provide: PRODUCT_GROUP_REPOSITORY,
      useFactory: (prisma: PrismaClient): ProductGroupRepositoryPort =>
        new PrismaProductGroupRepositoryAdapter(prisma),
      inject: [PRISMA],
    },
    {
      provide: PRODUCT_GROUP_PREFERENCE_REPOSITORY,
      useFactory: (prisma: PrismaClient): ProductGroupPreferenceRepositoryPort =>
        new PrismaProductGroupPreferenceRepositoryAdapter(prisma),
      inject: [PRISMA],
    },
    {
      provide: PRICE_OBSERVATION_REPOSITORY,
      useFactory: (prisma: PrismaClient): PriceObservationRepositoryPort =>
        new PrismaPriceObservationRepositoryAdapter(prisma),
      inject: [PRISMA],
    },
    {
      provide: ResolveProductReferenceUseCase,
      useFactory: (): ResolveProductReferenceUseCase =>
        new ResolveProductReferenceUseCase([new OzonReferenceParser(), new DnsReferenceParser()]),
    },
    {
      provide: AddProductUseCase,
      useFactory: (
        resolve: ResolveProductReferenceUseCase,
        products: TrackedProductRepositoryPort,
        groups: ProductGroupRepositoryPort,
        observations: PriceObservationRepositoryPort,
        requestObservation: RequestPriceObservationUseCase,
        limiter: RateLimiterPort,
        config: AppConfigInterface,
        logger: LoggerPort,
        expandLink: ExpandProductLinkUseCase,
        findCity: FindCityUseCase,
      ): AddProductUseCase =>
        new AddProductUseCase(
          resolve,
          products,
          groups,
          observations,
          requestObservation,
          limiter,
          {
            maxProducts: config.productsPerUserMax,
            maxProductsPerGroup: config.productGroupItemsMax,
            add: { limit: config.productAddMaxAttempts, windowMs: config.productAddWindowMs },
          },
          logger.child('products'),
          expandLink,
          {
            find: (marketplace, cityId): Promise<{ name: string } | null> =>
              findCity.execute(marketplace, cityId),
          },
        ),
      inject: [
        ResolveProductReferenceUseCase,
        TRACKED_PRODUCT_REPOSITORY,
        PRODUCT_GROUP_REPOSITORY,
        PRICE_OBSERVATION_REPOSITORY,
        RequestPriceObservationUseCase,
        RATE_LIMITER,
        APP_CONFIG,
        LOGGER,
        ExpandProductLinkUseCase,
        FindCityUseCase,
      ],
    },
    {
      provide: PRODUCT_LINK_EXPANDER,
      useFactory: (config: AppConfigInterface, logger: LoggerPort): ProductLinkExpanderPort =>
        new BullmqProductLinkExpanderAdapter(config.redisUrl, logger.child('queue')),
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: ExpandProductLinkUseCase,
      useFactory: (
        choose: ChoosePriceRoutesUseCase,
        expander: ProductLinkExpanderPort,
        config: AppConfigInterface,
        logger: LoggerPort,
      ): ExpandProductLinkUseCase =>
        new ExpandProductLinkUseCase(
          new OzonShortLinkParser(),
          choose,
          expander,
          config.linkExpandTimeoutMs,
          logger.child('products'),
        ),
      inject: [ChoosePriceRoutesUseCase, PRODUCT_LINK_EXPANDER, APP_CONFIG, LOGGER],
    },
    {
      provide: GetProductStatsUseCase,
      useFactory: (products: TrackedProductRepositoryPort): GetProductStatsUseCase =>
        new GetProductStatsUseCase(products),
      inject: [TRACKED_PRODUCT_REPOSITORY],
    },
    {
      provide: RemoveProductUseCase,
      useFactory: (
        products: TrackedProductRepositoryPort,
        storage: ObjectStoragePort,
        logger: LoggerPort,
      ): RemoveProductUseCase =>
        new RemoveProductUseCase(products, storage, logger.child('products')),
      inject: [TRACKED_PRODUCT_REPOSITORY, OBJECT_STORAGE, LOGGER],
    },
    {
      provide: RemoveUserProductsUseCase,
      useFactory: (
        products: TrackedProductRepositoryPort,
        remove: RemoveProductUseCase,
      ): RemoveUserProductsUseCase => new RemoveUserProductsUseCase(products, remove),
      inject: [TRACKED_PRODUCT_REPOSITORY, RemoveProductUseCase],
    },
    {
      provide: IMAGE_DOWNLOADER,
      useFactory: (): ImageDownloaderPort => new HttpImageDownloaderAdapter(),
    },
    {
      provide: StoreProductThumbnailUseCase,
      useFactory: (
        products: TrackedProductRepositoryPort,
        storage: ObjectStoragePort,
        downloader: ImageDownloaderPort,
        logger: LoggerPort,
      ): StoreProductThumbnailUseCase =>
        new StoreProductThumbnailUseCase(products, storage, downloader, logger.child('thumbnails')),
      inject: [TRACKED_PRODUCT_REPOSITORY, OBJECT_STORAGE, IMAGE_DOWNLOADER, LOGGER],
    },
    {
      provide: GetProductThumbnailUrlUseCase,
      useFactory: (storage: ObjectStoragePort): GetProductThumbnailUrlUseCase =>
        new GetProductThumbnailUrlUseCase(storage),
      inject: [OBJECT_STORAGE],
    },
    {
      provide: DescribeProductGroupsUseCase,
      useFactory: (
        groups: ProductGroupRepositoryPort,
        products: TrackedProductRepositoryPort,
        observations: PriceObservationRepositoryPort,
      ): DescribeProductGroupsUseCase =>
        new DescribeProductGroupsUseCase(groups, products, observations),
      inject: [PRODUCT_GROUP_REPOSITORY, TRACKED_PRODUCT_REPOSITORY, PRICE_OBSERVATION_REPOSITORY],
    },
    {
      provide: ListProductGroupsUseCase,
      useFactory: (
        groups: ProductGroupRepositoryPort,
        preferences: ProductGroupPreferenceRepositoryPort,
        describe: DescribeProductGroupsUseCase,
      ): ListProductGroupsUseCase => new ListProductGroupsUseCase(groups, preferences, describe),
      inject: [
        PRODUCT_GROUP_REPOSITORY,
        PRODUCT_GROUP_PREFERENCE_REPOSITORY,
        DescribeProductGroupsUseCase,
      ],
    },
    {
      provide: GetProductGroupUseCase,
      useFactory: (
        groups: ProductGroupRepositoryPort,
        preferences: ProductGroupPreferenceRepositoryPort,
        describe: DescribeProductGroupsUseCase,
      ): GetProductGroupUseCase => new GetProductGroupUseCase(groups, preferences, describe),
      inject: [
        PRODUCT_GROUP_REPOSITORY,
        PRODUCT_GROUP_PREFERENCE_REPOSITORY,
        DescribeProductGroupsUseCase,
      ],
    },
    {
      provide: CreateProductGroupUseCase,
      useFactory: (groups: ProductGroupRepositoryPort): CreateProductGroupUseCase =>
        new CreateProductGroupUseCase(groups),
      inject: [PRODUCT_GROUP_REPOSITORY],
    },
    {
      provide: RenameProductGroupUseCase,
      useFactory: (groups: ProductGroupRepositoryPort): RenameProductGroupUseCase =>
        new RenameProductGroupUseCase(groups),
      inject: [PRODUCT_GROUP_REPOSITORY],
    },
    {
      provide: RemoveProductGroupUseCase,
      useFactory: (
        groups: ProductGroupRepositoryPort,
        remove: RemoveProductUseCase,
      ): RemoveProductGroupUseCase => new RemoveProductGroupUseCase(groups, remove),
      inject: [PRODUCT_GROUP_REPOSITORY, RemoveProductUseCase],
    },
    {
      provide: SetStatsPeriodUseCase,
      useFactory: (preferences: ProductGroupPreferenceRepositoryPort): SetStatsPeriodUseCase =>
        new SetStatsPeriodUseCase(preferences),
      inject: [PRODUCT_GROUP_PREFERENCE_REPOSITORY],
    },
    {
      provide: ChoosePriceRoutesUseCase,
      useFactory: (
        proxyServers: ListBestProxyServersUseCase,
        config: AppConfigInterface,
      ): ChoosePriceRoutesUseCase =>
        new ChoosePriceRoutesUseCase(proxyServers, config.priceProxyCount),
      inject: [ListBestProxyServersUseCase, APP_CONFIG],
    },
    {
      provide: RequestPriceObservationUseCase,
      useFactory: (
        products: TrackedProductRepositoryPort,
        chooseRoutes: ChoosePriceRoutesUseCase,
        scheduleJob: ScheduleJobUseCase,
        config: AppConfigInterface,
        logger: LoggerPort,
      ): RequestPriceObservationUseCase =>
        new RequestPriceObservationUseCase(
          products,
          chooseRoutes,
          scheduleJob,
          config.priceTimeoutMs,
          logger.child('products'),
        ),
      inject: [
        TRACKED_PRODUCT_REPOSITORY,
        ChoosePriceRoutesUseCase,
        ScheduleJobUseCase,
        APP_CONFIG,
        LOGGER,
      ],
    },
    {
      provide: SpreadPriceJobsUseCase,
      useFactory: (config: AppConfigInterface): SpreadPriceJobsUseCase =>
        new SpreadPriceJobsUseCase(config.priceProxyLagMs),
      inject: [APP_CONFIG],
    },
    {
      provide: RefreshPricesUseCase,
      useFactory: (
        products: TrackedProductRepositoryPort,
        chooseRoutes: ChoosePriceRoutesUseCase,
        scheduleJob: ScheduleJobUseCase,
        spread: SpreadPriceJobsUseCase,
        config: AppConfigInterface,
        logger: LoggerPort,
      ): RefreshPricesUseCase =>
        new RefreshPricesUseCase(
          products,
          chooseRoutes,
          scheduleJob,
          spread,
          {
            refreshAfterMs: config.priceRefreshAfterMs,
            batchSize: config.priceRefreshBatchSize,
            timeoutMs: config.priceTimeoutMs,
          },
          systemClock,
          logger.child('price-refresh'),
        ),
      inject: [
        TRACKED_PRODUCT_REPOSITORY,
        ChoosePriceRoutesUseCase,
        ScheduleJobUseCase,
        SpreadPriceJobsUseCase,
        APP_CONFIG,
        LOGGER,
      ],
    },
    {
      provide: PeriodicPriceRefreshAdapter,
      useFactory: (
        refresh: RefreshPricesUseCase,
        limiter: RateLimiterPort,
        config: AppConfigInterface,
        logger: LoggerPort,
      ): PeriodicPriceRefreshAdapter =>
        new PeriodicPriceRefreshAdapter(
          refresh,
          limiter,
          {
            pollMs: config.priceRefreshPollMs,
            refreshAfterMs: config.priceRefreshAfterMs,
          },
          logger.child('price-refresh'),
        ),
      inject: [RefreshPricesUseCase, RATE_LIMITER, APP_CONFIG, LOGGER],
    },
    {
      provide: ListPriceHistoryUseCase,
      useFactory: (
        products: TrackedProductRepositoryPort,
        observations: PriceObservationRepositoryPort,
      ): ListPriceHistoryUseCase => new ListPriceHistoryUseCase(products, observations),
      inject: [TRACKED_PRODUCT_REPOSITORY, PRICE_OBSERVATION_REPOSITORY],
    },
    {
      provide: RecordPriceResultUseCase,
      useFactory: (
        products: TrackedProductRepositoryPort,
        observations: PriceObservationRepositoryPort,
        thumbnails: StoreProductThumbnailUseCase,
        proxyAttempts: RecordProxyAttemptsUseCase,
        logger: LoggerPort,
      ): RecordPriceResultUseCase =>
        new RecordPriceResultUseCase(
          products,
          observations,
          thumbnails,
          proxyAttempts,
          logger.child('price-results'),
        ),
      inject: [
        TRACKED_PRODUCT_REPOSITORY,
        PRICE_OBSERVATION_REPOSITORY,
        StoreProductThumbnailUseCase,
        RecordProxyAttemptsUseCase,
        LOGGER,
      ],
    },
    PriceResultsConsumer,
  ],
  exports: [GetProductStatsUseCase, RemoveUserProductsUseCase],
})
export class ProductModule {}
