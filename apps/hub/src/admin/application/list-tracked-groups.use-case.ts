import type { GetAccountUseCase } from '../../account/application/index.js';
import type {
  ListAllProductGroupsUseCase,
  ProductGroupViewInterface,
} from '../../product/application/index.js';
import type {
  PageInterface,
  PaginationInterface,
} from '../../shared/application/page.interface.js';

export interface TrackedGroupInterface {
  view: ProductGroupViewInterface;
  /** The email of the user who owns the group; null for a user gone meanwhile. */
  ownerEmail: string | null;
}

/** The groups the users track, the newest first, each with the email of its owner. */
export class ListTrackedGroupsUseCase {
  constructor(
    private readonly groups: Pick<ListAllProductGroupsUseCase, 'execute'>,
    private readonly accounts: Pick<GetAccountUseCase, 'execute'>,
  ) {}

  async execute(pagination: PaginationInterface): Promise<PageInterface<TrackedGroupInterface>> {
    const page = await this.groups.execute(pagination);
    const owners = [...new Set(page.items.map(({ group }): string => group.snapshot.userId))];
    const emails = new Map(
      await Promise.all(
        owners.map(async (userId): Promise<[string, string | null]> => [
          userId,
          (await this.accounts.execute(userId))?.email ?? null,
        ]),
      ),
    );

    return {
      items: page.items.map((view): TrackedGroupInterface => ({
        view,
        ownerEmail: emails.get(view.group.snapshot.userId) ?? null,
      })),
      total: page.total,
    };
  }
}
