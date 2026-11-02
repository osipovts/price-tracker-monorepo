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

      if (request.method === 'DELETE') return new Response(null, { status: 204 });
      if (pathname === `/product-groups/${groupId}`) {
        if (request.method === 'PATCH') return new Response(null, { status: 204 });
        if (status !== 200) return Response.json({ message: 'no' }, { status });

        return Response.json({
          id: groupId,
          title: 'Notebook',
          thumbnailUrl: null,
          createdAt: '2026-10-31T10:00:00.000Z',
          productCount: 2,
          lastCheck: null,
          nextCheckAt: null,
          current: {
            marketplace: 'dns',
            amountMinor: 90_000,
            observedAt: new Date().toISOString(),
          },
          min: null,
          max: null,
          highlighted: false,
          statsPeriod: '24h',
          products: [
            product(ozonId, 'ozon'),
            product(dnsId, 'dns', { cityName: 'Иркутск', latest: observation(dnsId, 1, 90_000) }),
          ],
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

test('shows the title, the best price, and where to buy, the cheapest first, each row a link to its marketplace', async (): Promise<void> => {
  stubHub();
  renderPage();

  // A title can be a paragraph: one line of the header, the whole of it in the hint.
  expect(await screen.findByRole('heading', { name: 'Notebook' })).toHaveAttribute(
    'title',
    'Notebook',
  );
  expect(screen.getAllByText(/^900[\s\u00a0]₽$/)).toHaveLength(2);
  const offers = screen.getAllByTitle(/^Open on /);
  expect(offers.map((offer) => offer.getAttribute('href'))).toEqual([
    'https://dns.example/p',
    'https://ozon.example/p',
  ]);
  const [, ozon] = offers;
  if (ozon === undefined) throw new Error('no offer of ozon');
  // The name and the price are in the link; the cross is not.
  expect(within(ozon).getByText('ozon')).toBeInTheDocument();
  expect(within(ozon).getByText(/^1[\s\u00a0]000[\s\u00a0]₽$/)).toBeInTheDocument();
  expect(within(ozon).queryByRole('button')).not.toBeInTheDocument();
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
  expect(screen.getByText('ozon', { selector: 'p' }).closest('a')).toBeNull();
  expect(screen.queryByTitle('Open on ozon')).not.toBeInTheDocument();
});

test('tells under each offer its last check by the day, and the next one by the time', async (): Promise<void> => {
  stubHub({
    group: {
      productCount: 1,
      products: [
        product(ozonId, 'ozon', {
          lastCheckedAt: '2026-10-05T12:00:00Z',
          nextCheckAt: '2099-01-01T12:00:00Z',
        }),
      ],
    },
  });
  renderPage();

  expect(
    await screen.findByText(/^Checked 05\.10\.2026, [^.]+\. Next check \d{1,2}:\d{2}( [AP]M)?$/),
  ).toBeInTheDocument();
});

test('strikes out the name and the price of an offer that is out of stock', async (): Promise<void> => {
  stubHub({
    group: {
      productCount: 1,
      products: [
        product(ozonId, 'ozon', {
          latest: { ...observation(ozonId, 1, 100_000), availability: 'out_of_stock' },
        }),
      ],
    },
  });
  renderPage();

  expect(await screen.findByText('ozon', { selector: 'p' })).toHaveStyle({
    textDecoration: 'line-through',
  });
  const price = screen.getAllByText(/^1[\s\u00a0]000[\s\u00a0]₽$/).at(-1);
  expect(price).toHaveStyle({ textDecoration: 'line-through' });
  expect(price).toHaveAttribute('title', 'Out of stock');
});

test('names a group that has no name after nothing but says it waits for prices', async (): Promise<void> => {
  stubHub({
    group: { title: null, productCount: 1, products: [product(ozonId, 'ozon', { latest: null })] },
  });
  renderPage();

  expect(
    await screen.findByRole('heading', { name: 'Product without a name yet' }),
  ).toBeInTheDocument();
  expect(screen.getByText(/^waiting for the first price\. /)).toBeInTheDocument();
});

test('stops tracking an offer by its cross, once it is confirmed', async (): Promise<void> => {
  const requests: string[] = [];
  stubHub({ requests });
  renderPage();

  const [cross] = await screen.findAllByRole('button', { name: 'Stop tracking' });
  if (cross === undefined) throw new Error('no cross');
  await userEvent.click(cross);
  const dialog = screen.getByRole('dialog', { name: 'Stop tracking the product?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Stop tracking' }));

  await waitFor((): void => {
    expect(requests).toContain(`DELETE /products/${dnsId}`);
  });
});

test('keeps the checks under a button, and pages through them, the newest first', async (): Promise<void> => {
  stubHub({
    history: {
      [ozonId]: Array.from({ length: 15 }, (_, index) => observation(ozonId, index + 1, 100_000)),
      [dnsId]: Array.from({ length: 10 }, (_, index) => observation(dnsId, index + 1, 90_000)),
    },
  });
  renderPage();

  await userEvent.click(await screen.findByRole('button', { name: 'All the checks (25)' }));
  expect(screen.getAllByRole('row')).toHaveLength(21);
  await userEvent.click(screen.getByRole('button', { name: '2' }));
  expect(screen.getAllByRole('row')).toHaveLength(6);
});

test('draws the history by hour, by day or by week over a year', async (): Promise<void> => {
  stubHub({ history: { [ozonId]: [observation(ozonId, 1, 100_000)] } });
  renderPage();

  expect(await screen.findByRole('radio', { name: '48 h' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '30 days' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '1 year' })).toBeInTheDocument();
});

test('renames the group from its menu', async (): Promise<void> => {
  const requests: string[] = [];
  stubHub({ requests });
  renderPage();

  await userEvent.click(await screen.findByRole('button', { name: 'Actions with the group' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  const input = screen.getByRole('textbox', { name: 'Rename' });
  await userEvent.clear(input);
  await userEvent.type(input, 'Laptop');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor((): void => {
    expect(requests).toContain(`PATCH /product-groups/${groupId} {"title":"Laptop"}`);
  });
});

test('adds a link to the group in a window', async (): Promise<void> => {
  stubHub();
  renderPage();

  await userEvent.click(await screen.findByRole('button', { name: 'Add' }));

  expect(screen.getByRole('dialog', { name: 'Add to the group' })).toBeInTheDocument();
  expect(screen.getByLabelText(/link/i)).toBeInTheDocument();
});

test("says so when the group is not the user's", async (): Promise<void> => {
  stubHub({ status: 404 });
  renderPage();

  expect(await screen.findByText('This group does not exist.')).toBeInTheDocument();
});
