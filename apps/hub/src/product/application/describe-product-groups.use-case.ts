import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import type { PriceObservationInterface } from '../domain/price-observation.interface.js';
import type { ProductGroupEntity } from '../domain/product-group.entity.js';
import { statsPeriodMs, type StatsPeriodType } from '../domain/stats-period.type.js';
import type { TrackedProductEntity } from '../domain/tracked-product.entity.js';
import {
  type GroupPriceSummaryInterface,
  summarizeGroupPrices,
} from './group-price-summary.type.js';
import type { PriceObservationRepositoryPort } from './price-observation-repository.port.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';
import type { TrackedProductRepositoryPort } from './tracked-product-repository.port.js';

export interface ProductOfGroupInterface {
  product: TrackedProductEntity;
  /** The newest price observation, null until the first one is recorded. */
  latest: PriceObservationInterface | null;
}

export interface ProductGroupViewInterface {
  group: ProductGroupEntity;
  /** The title the user gave, else the one of the first product; null while the group has no product with a title. */
  title: string | null;
  /** The picture of the first product that has one; null when none has. */
  thumbnailKey: string | null;
  /** In the order they were added. */
  products: ProductOfGroupInterface[];
  prices: GroupPriceSummaryInterface;
  /** The period the lowest and the highest price are of. */
  statsPeriod: StatsPeriodType;
}

/** Shows groups as the user sees them: the title and the picture they have, the products, and what the products cost. */
export class DescribeProductGroupsUseCase {
  constructor(
    private readonly groups: ProductGroupRepositoryPort,
    private readonly products: TrackedProductRepositoryPort,
    private readonly observations: PriceObservationRepositoryPort,
    private readonly clock: ClockPort = systemClock,
  ) {}

  async execute(
    groups: readonly ProductGroupEntity[],
    period: StatsPeriodType,
  ): Promise<ProductGroupViewInterface[]> {
    const items = await this.groups.listProductIds(
      groups.map(({ snapshot }): string => snapshot.id),
    );
    const products = new Map(
      (await Promise.all(items.map(({ productId }) => this.products.findById(productId)))).flatMap(
        (product): Array<[string, TrackedProductEntity]> =>
          product === null ? [] : [[product.snapshot.id, product]],
      ),
    );
    const productIds = [...products.keys()];

    const now = this.clock.now();
    const latest = await this.observations.findLatestByProducts(productIds);
    const history = await this.observations.listSince(
      productIds,
      new Date(now.getTime() - statsPeriodMs[period]),
    );
    const observations = [...new Map([...latest, ...history].map((o) => [o.id, o])).values()];

    return groups.map((group): ProductGroupViewInterface => {
      const own = items
        .filter(({ groupId }): boolean => groupId === group.snapshot.id)
        .flatMap(({ productId }): TrackedProductEntity[] => {
          const product = products.get(productId);

          return product === undefined ? [] : [product];
        });
      const ownLatest = own.map((product): ProductOfGroupInterface => ({
        product,
        latest: latest.find((o) => o.trackedProductId === product.snapshot.id) ?? null,
      }));

      return {
        group,
        title: group.snapshot.title ?? ownLatest[0]?.latest?.title ?? null,
        thumbnailKey:
          own.find(({ snapshot }): boolean => snapshot.thumbnailKey !== null)?.snapshot
            .thumbnailKey ?? null,
        products: ownLatest,
        prices: summarizeGroupPrices({
          products: own.map(({ snapshot }) => snapshot),
          observations: observations.filter((o) =>
            own.some(({ snapshot }): boolean => snapshot.id === o.trackedProductId),
          ),
          period,
          now,
        }),
        statsPeriod: period,
      };
    });
  }
}
