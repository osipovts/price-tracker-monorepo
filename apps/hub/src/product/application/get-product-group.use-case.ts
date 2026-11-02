import type {
  DescribeProductGroupsUseCase,
  ProductGroupViewInterface,
} from './describe-product-groups.use-case.js';
import { ProductGroupNotFoundError } from './product-group-not-found.error.js';
import type { ProductGroupPreferenceRepositoryPort } from './product-group-preference-repository.port.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';

export class GetProductGroupUseCase {
  constructor(
    private readonly groups: ProductGroupRepositoryPort,
    private readonly preferences: ProductGroupPreferenceRepositoryPort,
    private readonly describe: Pick<DescribeProductGroupsUseCase, 'execute'>,
  ) {}

  async execute(userId: string, groupId: string): Promise<ProductGroupViewInterface> {
    const group = await this.groups.findOwned(userId, groupId);
    if (group === null) throw new ProductGroupNotFoundError(groupId);

    const [view] = await this.describe.execute(
      [group],
      await this.preferences.getStatsPeriod(userId),
    );
    if (view === undefined) throw new ProductGroupNotFoundError(groupId);

    return view;
  }
}
