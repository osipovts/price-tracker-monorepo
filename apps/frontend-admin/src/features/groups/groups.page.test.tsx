import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { GroupsPage } from './groups.page.js';

const groupId = '11111111-1111-4111-8111-111111111111';

test('lists the groups of the users with their owners, and opens one in the app, read-only', async (): Promise<void> => {
  vi.stubGlobal(
    'fetch',
    vi.fn((): Promise<Response> =>
      Promise.resolve(
        Response.json({
          items: [
            {
              id: groupId,
              title: 'Notebook',
              thumbnailUrl: null,
              ownerEmail: 'jane@example.com',
              createdAt: '2026-11-01T10:00:00.000Z',
              marketplaces: ['ozon', 'wildberries'],
              lastCheck: { marketplace: 'ozon', checkedAt: '2026-11-10T10:00:00.000Z' },
              current: {
                marketplace: 'wildberries',
                amountMinor: 9_000_000,
                observedAt: '2026-11-10T10:00:00.000Z',
              },
            },
            {
              id: '22222222-2222-4222-8222-222222222222',
              title: null,
              thumbnailUrl: null,
              ownerEmail: null,
              createdAt: '2026-11-01T09:00:00.000Z',
              marketplaces: [],
              lastCheck: null,
              current: null,
            },
          ],
          page: 1,
          pageSize: 25,
          total: 2,
        }),
      ),
    ),
  );
  render(
    <MantineProvider env="test">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <GroupsPage />
      </QueryClientProvider>
    </MantineProvider>,
  );

  const notebook = (await screen.findByRole('link', { name: 'Notebook' })).closest('tr');
  if (notebook === null) throw new Error('no row of the group');
  expect(within(notebook).getByText('jane@example.com')).toBeInTheDocument();
  expect(within(notebook).getAllByText('wb')).toHaveLength(2);
  expect(within(notebook).getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    `/app/view/groups/${groupId}`,
  );
  expect(screen.getByText('Untitled')).toBeInTheDocument();
  expect(screen.getByText('user gone')).toBeInTheDocument();
});
