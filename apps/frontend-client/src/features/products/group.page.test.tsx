import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';

import { GroupPage } from './group.page.js';

const groupId = '11111111-1111-4111-8111-111111111111';
const ozonId = '22222222-2222-4222-8222-222222222222';
const dnsId = '33333333-3333-4333-8333-333333333333';

function observation(productId: string, n: number, amountMinor: number): Record<string, unknown> {
  return {
    id: `${productId.slice(0, 24)}${String(n).padStart(12, '0')}`,
    observedAt: new Date(Date.now() - n * 3_600_000).toISOString(),
    title: 'Notebook ASUS',
    availability: 'in_stock',
    prices: [{ amountMinor, currency: 'RUB' }],
    exitIp: null,
  };
}

function product(
  id: string,
  marketplace: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    marketplace,
    externalId: id.slice(0, 4),
    url: `https://${marketplace}.example/p`,
    cityId: null,
    cityName: null,
    lastStatus: null,
    lastCheckedAt: null,
    nextCheckAt: null,
    thumbnailUrl: null,
    latest: observation(id, 1, 100_000),
    ...extra,
  };
}

interface HubInterface {
  group?: Record<string, unknown>;
  history?: Record<string, Array<Record<string, unknown>>>;
  status?: number;
  requests?: string[];
}

function stubHub({
  group = {},
  history = {},
  status = 200,
  requests = [],
}: HubInterface = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request): Promise<Response> => {
      const { pathname } = new URL(request.url);
      requests.push(
        `${request.method} ${pathname}${request.body === null ? '' : ` ${JSON.stringify(await request.json())}`}`,
      );

      if (pathname === `/product-groups/${groupId}`) {
        if (request.method === 'PATCH') return new Response(null, { status: 204 });
        if (status !== 200) return Response.json({ message: 'no' }, { status });

        return Response.json({
          id: groupId,
          title: 'Notebook',
          thumbnailUrl: null,
          createdAt: '2026-10-31T10:00:00.000Z',
          productCount: 2,
          current: {
            marketplace: 'dns',
            amountMinor: 90_000,
            observedAt: new Date().toISOString(),
          },
          min: null,
          max: null,
          highlighted: false,
          statsPeriod: '24h',
          products: [product(ozonId, 'ozon'), product(dnsId, 'dns', { cityName: 'Иркутск' })],
          ...group,
        });
      }

      const id = pathname.split('/')[2] ?? '';
      const items = history[id] ?? [];

      return Response.json({
        product: product(id, 'ozon'),
        items,
        page: 1,
        pageSize: 100,
        total: items.length,
      });
    }),
  );
}

function renderPage(): void {
  render(
    <MantineProvider env="test">
      <MemoryRouter initialEntries={[`/groups/${groupId}`]}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <Routes>
            <Route path="groups/:id" element={<GroupPage />} />
            <Route path="/" element={<p>home</p>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach((): void => {
  sessionStorage.clear();
});

test('shows the title, the best price and a card for each product of the group, with its city', async (): Promise<void> => {
  stubHub();
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Notebook' })).toBeInTheDocument();
  expect(screen.getByText('Products in the group: 2')).toBeInTheDocument();
  expect(within(screen.getByTestId('price-Now')).getByText('dns')).toBeInTheDocument();
  expect(screen.getByText('City: Иркутск')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /Open on/ })).toHaveLength(2);
});

test('does not link to an address that is not a web page', async (): Promise<void> => {
  stubHub({
    group: {
      productCount: 1,
      products: [product(ozonId, 'ozon', { url: 'javascript:alert(1)' })],
    },
  });
  renderPage();

  await screen.findByRole('heading', { name: 'Notebook' });
  expect(screen.queryByRole('link', { name: /Open on/ })).not.toBeInTheDocument();
});

test('names a group that has no name after nothing but says it waits for prices', async (): Promise<void> => {
  stubHub({
    group: { title: null, productCount: 1, products: [product(ozonId, 'ozon', { latest: null })] },
  });
  renderPage();

  expect(
    await screen.findByRole('heading', { name: 'Product without a name yet' }),
  ).toBeInTheDocument();
  expect(screen.getAllByText('waiting for the first price').length).toBeGreaterThan(0);
});

test('gathers the history of all the products in one table, the newest first, and pages through it', async (): Promise<void> => {
  stubHub({
    history: {
      [ozonId]: Array.from({ length: 15 }, (_, index) => observation(ozonId, index + 1, 100_000)),
      [dnsId]: Array.from({ length: 10 }, (_, index) => observation(dnsId, index + 1, 90_000)),
    },
  });
  renderPage();

  await screen.findByRole('heading', { name: 'Notebook' });
  await waitFor((): void => {
    expect(screen.getAllByRole('row')).toHaveLength(21);
  });
  await userEvent.click(screen.getByRole('button', { name: '2' }));
  expect(screen.getAllByRole('row')).toHaveLength(6);
});

test('renames the group', async (): Promise<void> => {
  const requests: string[] = [];
  stubHub({ requests });
  renderPage();

  await userEvent.click(await screen.findByRole('button', { name: 'Rename' }));
  const input = screen.getByRole('textbox', { name: 'Rename' });
  await userEvent.clear(input);
  await userEvent.type(input, 'Laptop');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor((): void => {
    expect(requests).toContain(`PATCH /product-groups/${groupId} {"title":"Laptop"}`);
  });
});

test("says so when the group is not the user's", async (): Promise<void> => {
  stubHub({ status: 404 });
  renderPage();

  expect(await screen.findByText('This group does not exist.')).toBeInTheDocument();
});
