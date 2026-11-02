import type {
  PageInterface,
  PaginationInterface,
} from '../../shared/application/page.interface.js';
import type { StatsPeriodType } from '../domain/stats-period.type.js';
import type {
  DescribeProductGroupsUseCase,
  ProductGroupViewInterface,
} from './describe-product-groups.use-case.js';
import type { ProductGroupPreferenceRepositoryPort } from './product-group-preference-repository.port.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';

export interface ProductGroupPageInterface extends PageInterface<ProductGroupViewInterface> {
  /** The period the user chose for the lowest and the highest price. */
  statsPeriod: StatsPeriodType;
}

export class ListProductGroupsUseCase {
  constructor(
    private readonly groups: ProductGroupRepositoryPort,
    private readonly preferences: ProductGroupPreferenceRepositoryPort,
    private readonly describe: Pick<DescribeProductGroupsUseCase, 'execute'>,
  ) {}

  async execute(
    userId: string,
    pagination: PaginationInterface,
  ): Promise<ProductGroupPageInterface> {
    const statsPeriod = await this.preferences.getStatsPeriod(userId);
    const page = await this.groups.listOwned(userId, pagination);

    return {
      items: await this.describe.execute(page.items, statsPeriod),
      total: page.total,
      statsPeriod,
    };
  }
}
