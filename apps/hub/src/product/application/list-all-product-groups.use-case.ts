import type {
  PageInterface,
  PaginationInterface,
} from '../../shared/application/page.interface.js';
import { defaultStatsPeriod } from '../domain/stats-period.type.js';
import type {
  DescribeProductGroupsUseCase,
  ProductGroupViewInterface,
} from './describe-product-groups.use-case.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';

/** The groups of every user, the newest first, as their owners see them: for an administrator. */
export class ListAllProductGroupsUseCase {
  constructor(
    private readonly groups: ProductGroupRepositoryPort,
    private readonly describe: Pick<DescribeProductGroupsUseCase, 'execute'>,
  ) {}

  async execute(
    pagination: PaginationInterface,
  ): Promise<PageInterface<ProductGroupViewInterface>> {
    const page = await this.groups.listAll(pagination);

    return {
      items: await this.describe.execute(page.items, defaultStatsPeriod),
      total: page.total,
    };
  }
}
