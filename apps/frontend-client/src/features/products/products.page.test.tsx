import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';

import { rememberPendingAdd } from './pending-add.type.js';
import { ProductsPage } from './products.page.js';

function price(
  marketplace: string,
  amountMinor: number,
  observedAt: string,
): { marketplace: string; amountMinor: number; observedAt: string } {
  return { marketplace, amountMinor, observedAt };
}
const group = {
  thumbnailUrl: null,
  createdAt: '2026-10-31T10:00:00.000Z',
  productCount: 1,
  current: null,
  min: null,
  max: null,
  highlighted: false,
};

function stubGroups(items: Array<Record<string, unknown>>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((): Promise<Response> =>
      Promise.resolve(
        Response.json({ items, page: 1, pageSize: 20, total: items.length, statsPeriod: '24h' }),
      ),
    ),
  );
}

beforeEach((): void => {
  sessionStorage.clear();
  stubGroups([
    { ...group, id: '11111111-1111-4111-8111-111111111111', title: null },
    {
      ...group,
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Notebook',
      current: price('ozon', 10_000_00, '2026-10-31T10:00:00.000Z'),
    },
  ]);
});

test('marks the card that waits for its first price, for the glint over it, and no other', async (): Promise<void> => {
  const { container } = render(
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ProductsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );

  expect(await screen.findByText('waiting for the first price')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-waiting="true"]')).toHaveLength(1);
  expect(container.querySelectorAll('.mantine-Card-root')).toHaveLength(3);
  expect(screen.getAllByText('It can take up to 10 minutes.')).toHaveLength(1);
});

test('tells that adding a product can take minutes once it has taken over 5 seconds', async (): Promise<void> => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    vi.stubGlobal(
      'fetch',
      vi.fn((request: Request | string | URL): Promise<Response> =>
        typeof request === 'string' || request instanceof URL || request.method === 'GET'
          ? Promise.resolve(
              Response.json({ items: [], page: 1, pageSize: 20, total: 0, statsPeriod: '24h' }),
            )
          : new Promise<Response>(() => undefined),
      ),
    );
    render(
      <MantineProvider>
        <MemoryRouter>
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          >
            <ProductsPage />
          </QueryClientProvider>
        </MemoryRouter>
      </MantineProvider>,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await user.type(screen.getByLabelText(/link/i), 'https://ozon.ru/t/AbC');
    await user.click(screen.getByRole('button', { name: 'Track' }));
    expect(screen.queryByText(/Adding a product can take a few minutes/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/link/i)).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(5000));

    expect(screen.getByText(/Adding a product can take a few minutes/)).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('sends again the link whose add was cut short by a reload', async (): Promise<void> => {
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request | string | URL): Promise<Response> => {
      if (typeof request === 'string' || request instanceof URL || request.method === 'GET')
        return Response.json({ items: [], page: 1, pageSize: 20, total: 0, statsPeriod: '24h' });

      sent.push(JSON.stringify(await request.json()));

      return new Promise<Response>(() => undefined);
    }),
  );
  rememberPendingAdd({ url: 'https://ozon.ru/t/AbC', cityId: null, groupId: null });

  render(
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ProductsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );

  expect(await screen.findByDisplayValue('https://ozon.ru/t/AbC')).toBeDisabled();
  await waitFor((): void => {
    expect(sent).toEqual([JSON.stringify({ url: 'https://ozon.ru/t/AbC' })]);
  });
});

const dnsLink = 'https://www.dns-shop.ru/product/0463bb2411a1d582/156-noutbuk/';

test('asks for the city of a link of a marketplace that has cities, searches it by name, and sends its id', async (): Promise<void> => {
  const sent: string[] = [];
  const searched: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request | string | URL): Promise<Response> => {
      if (typeof request === 'string' || request instanceof URL)
        return Response.json({ items: [], page: 1, pageSize: 20, total: 0, statsPeriod: '24h' });
      if (request.method === 'GET') {
        const { pathname, searchParams } = new URL(request.url);
        if (pathname === '/marketplaces/dns/cities') {
          searched.push(searchParams.get('query') ?? '');

          return Response.json({
            items: [{ id: 'irkutsk-id', name: 'Иркутск', region: 'Иркутская область' }],
          });
        }

        return Response.json({ items: [], page: 1, pageSize: 20, total: 0, statsPeriod: '24h' });
      }

      sent.push(JSON.stringify(await request.json()));

      return new Promise<Response>(() => undefined);
    }),
  );
  render(
    <MantineProvider env="test">
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ProductsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
  const user = userEvent.setup();

  expect(screen.queryByLabelText('City', { selector: 'input' })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText(/link/i), 'https://ozon.ru/t/AbC');
  expect(screen.queryByLabelText('City', { selector: 'input' })).not.toBeInTheDocument();

  await user.clear(screen.getByLabelText(/link/i));
  await user.type(screen.getByLabelText(/link/i), dnsLink);
  await user.type(screen.getByLabelText('City', { selector: 'input' }), 'Ирк');
  await user.click(await screen.findByRole('option', { name: /Иркутск/ }));
  await user.click(screen.getByRole('button', { name: 'Track' }));

  await waitFor((): void => {
    expect(sent).toEqual([JSON.stringify({ url: dnsLink, cityId: 'irkutsk-id' })]);
  });
  expect(searched).toContain('Ирк');
});

test('shows the best price with its marketplace, highlighted when it is not above the lowest, with the lowest and the highest', async (): Promise<void> => {
  const today = new Date().toISOString();
  stubGroups([
    {
      ...group,
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Phone',
      productCount: 2,
      current: price('dns', 9_000_00, today),
      min: price('ozon', 9_500_00, '2026-10-05T07:08:00.000Z'),
      max: price('ozon', 12_000_00, '2026-10-06T07:08:00.000Z'),
      highlighted: true,
    },
  ]);
  render(
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ProductsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );

  expect(await screen.findByText('Phone')).toBeInTheDocument();
  expect(screen.getByText('Products: 2')).toBeInTheDocument();
  const now = screen.getByTestId('price-Now');
  expect(within(now).getByText('dns')).toBeInTheDocument();
  expect(
    within(now)
      .getByText(/9[\s\u00a0]000/)
      .closest('[data-highlighted="true"]'),
  ).not.toBeNull();
  expect(within(now).getByText(/^today, /)).toBeInTheDocument();
  expect(within(screen.getByTestId('price-Lowest')).getByText('ozon')).toBeInTheDocument();
  expect(screen.getByTestId('price-Lowest')).toHaveTextContent(/\d\d\.\d\d\.2026/);
  expect(within(screen.getByTestId('price-Highest')).queryByText(/9[\s\u00a0]000/)).toBeNull();
  expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(1);
});

test('remembers the period of the lowest and the highest price by telling the hub', async (): Promise<void> => {
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request | string | URL): Promise<Response> => {
      if (typeof request !== 'string' && !(request instanceof URL) && request.method === 'PUT') {
        sent.push(`${new URL(request.url).pathname} ${JSON.stringify(await request.json())}`);

        return new Response(null, { status: 204 });
      }

      return Response.json({ items: [], page: 1, pageSize: 20, total: 0, statsPeriod: '24h' });
    }),
  );
  render(
    <MantineProvider env="test">
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ProductsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );

  await userEvent.click(await screen.findByText('7 days'));

  await waitFor((): void => {
    expect(sent).toEqual(['/product-groups/stats-period {"statsPeriod":"7d"}']);
  });
});

test('says the hub could not be reached when the request does not get there', async (): Promise<void> => {
  vi.stubGlobal(
    'fetch',
    vi.fn((): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'))),
  );

  render(
    <MantineProvider>
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ProductsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );

  expect(await screen.findByText('The hub could not be reached.')).toBeInTheDocument();
  expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
});

test('sends the link whose add was cut short once, even when the page is mounted twice', async (): Promise<void> => {
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request | string | URL): Promise<Response> => {
      if (typeof request === 'string' || request instanceof URL || request.method === 'GET')
        return Response.json({ items: [], page: 1, pageSize: 20, total: 0, statsPeriod: '24h' });

      sent.push(JSON.stringify(await request.json()));

      return new Promise<Response>(() => undefined);
    }),
  );
  rememberPendingAdd({ url: 'https://ozon.ru/t/AbC', cityId: null, groupId: null });

  render(
    <StrictMode>
      <MantineProvider>
        <MemoryRouter>
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
          >
            <ProductsPage />
          </QueryClientProvider>
        </MemoryRouter>
      </MantineProvider>
    </StrictMode>,
  );

  await waitFor((): void => {
    expect(sent).not.toHaveLength(0);
  });
  await act(() => Promise.resolve());

  expect(sent).toHaveLength(1);
});
