import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { UserInterface } from '../../account/application/index.js';
import { DescribeProductGroupsUseCase } from '../../product/application/describe-product-groups.use-case.js';
import { ListAllProductGroupsUseCase } from '../../product/application/list-all-product-groups.use-case.js';
import { InMemoryPriceObservationRepositoryAdapter } from '../../product/infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryProductGroupRepositoryAdapter } from '../../product/infrastructure/in-memory-product-group-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../../product/infrastructure/in-memory-tracked-product-repository.adapter.js';
import { ListTrackedGroupsUseCase } from './list-tracked-groups.use-case.js';

void test('lists the groups of every user, the newest first, with the email of the owner', async (): Promise<void> => {
  const groups = new InMemoryProductGroupRepositoryAdapter();
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const observations = new InMemoryPriceObservationRepositoryAdapter();
  await groups.create('jane', 'Phone');
  await groups.create('sam', 'Kettle');
  await groups.create('gone', 'Lamp');
  const emails: Record<string, string> = { jane: 'jane@example.com', sam: 'sam@example.com' };

  const page = await new ListTrackedGroupsUseCase(
    new ListAllProductGroupsUseCase(
      groups,
      new DescribeProductGroupsUseCase(groups, products, observations),
    ),
    {
      execute: (userId: string): Promise<UserInterface | null> => {
        const email = emails[userId];

        return Promise.resolve(
          email === undefined
            ? null
            : { id: userId, email, emailVerifiedAt: null, createdAt: new Date() },
        );
      },
    },
  ).execute({ page: 1, pageSize: 10 });

  assert.equal(page.total, 3);
  assert.deepEqual(
    page.items.map(({ view, ownerEmail }): [string | null, string | null] => [
      view.title,
      ownerEmail,
    ]),
    [
      ['Lamp', null],
      ['Kettle', 'sam@example.com'],
      ['Phone', 'jane@example.com'],
    ],
  );
});
