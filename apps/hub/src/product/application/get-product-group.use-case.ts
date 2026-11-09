import type {
  DescribeProductGroupsUseCase,
  ProductGroupViewInterface,
} from './describe-product-groups.use-case.js';
import { ProductGroupNotFoundError } from './product-group-not-found.error.js';
import type { ProductGroupPreferenceRepositoryPort } from './product-group-preference-repository.port.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';
import { administratorViewer, type ProductViewerType } from './product-viewer.type.js';

export class GetProductGroupUseCase {
  constructor(
    private readonly groups: ProductGroupRepositoryPort,
    private readonly preferences: ProductGroupPreferenceRepositoryPort,
    private readonly describe: Pick<DescribeProductGroupsUseCase, 'execute'>,
  ) {}

  /** The group as its owner sees it, with the period they chose; to any other user it does not exist. */
  async execute(viewer: ProductViewerType, groupId: string): Promise<ProductGroupViewInterface> {
    const group =
      viewer === administratorViewer
        ? await this.groups.findById(groupId)
        : await this.groups.findOwned(viewer, groupId);
    if (group === null) throw new ProductGroupNotFoundError(groupId);

    const [view] = await this.describe.execute(
      [group],
      await this.preferences.getStatsPeriod(group.snapshot.userId),
    );
    if (view === undefined) throw new ProductGroupNotFoundError(groupId);

    return view;
  }
}
