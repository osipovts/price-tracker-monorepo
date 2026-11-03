import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, type RenderResult, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';

import { rememberPendingAdd } from './pending-add.type.js';
import { ProductsPage } from './products.page.js';

const group = {
  thumbnailUrl: null,
  createdAt: '2026-10-31T10:00:00.000Z',
  productCount: 1,
  lastCheck: null,
  current: null,
  min: null,
  max: null,
  highlighted: false,
};

function pageOf(items: Array<Record<string, unknown>>): Response {
  return Response.json({ items, page: 1, pageSize: 20, total: items.length, statsPeriod: '24h' });
}

function stubGroups(items: Array<Record<string, unknown>>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((): Promise<Response> => Promise.resolve(pageOf(items))),
  );
}

const trackedGroupId = '44444444-4444-4444-8444-444444444444';

/**
 * The hub lists no group, and records what is sent to it. An add never ends while `pending`; it is `added` as a
 * product the user tracks from now on (201), or answered as one the user `tracked` already (200), in the group of
 * `trackedGroupId`, called Old phone.
 */
function stubAdding(sent: string[], answer: 'pending' | 'added' | 'tracked' = 'pending'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request | string | URL): Promise<Response> => {
      if (typeof request === 'string' || request instanceof URL) return pageOf([]);
      if (request.method === 'GET') {
        return new URL(request.url).pathname === `/product-groups/${trackedGroupId}`
          ? Response.json({ ...group, id: trackedGroupId, title: 'Old phone', products: [] })
          : pageOf([]);
      }

      sent.push(JSON.stringify(await request.json()));
      if (answer === 'pending') return new Promise<Response>(() => undefined);

      return Response.json({ groupId: trackedGroupId }, { status: answer === 'added' ? 201 : 200 });
    }),
  );
}

function renderPage(strict = false): RenderResult {
  const page = (
    <MantineProvider env="test">
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <ProductsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>
  );

  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

/** The form of a new product is in a window, opened from the header or from the empty list. */
async function openForm(): Promise<void> {
  await userEvent.click(
    await screen.findByRole('button', { name: /^(Add|Add the first product)$/ }),
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
      current: { marketplace: 'ozon', amountMinor: 10_000_00, observedAt: '2026-10-31T10:00:00Z' },
    },
  ]);
});

test('marks the row that waits for its first price, for the glint over it, and no other', async (): Promise<void> => {
  const { container } = renderPage();

  expect(await screen.findByText('waiting for the first price')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-waiting="true"]')).toHaveLength(1);
  expect(screen.getByRole('link', { name: /Notebook/ })).toHaveAttribute(
    'href',
    '/groups/22222222-2222-4222-8222-222222222222',
  );
});

test('shows the best price with its marketplace and when it was read, and the last check of the group', async (): Promise<void> => {
  stubGroups([
    {
      ...group,
      id: '33333333-3333-4333-8333-333333333333',
      title: 'Phone',
      productCount: 2,
      current: { marketplace: 'dns', amountMinor: 9_000_00, observedAt: '2026-10-31T10:00:00Z' },
      lastCheck: { marketplace: 'ozon', checkedAt: '2026-10-05T12:00:00Z' },
    },
  ]);
  renderPage();

  expect(await screen.findByText('Phone')).toBeInTheDocument();
  expect(screen.getByText(/^9[\s\u00a0]000[\s\u00a0]₽$/).getAttribute('title')).toMatch(
    /^Price received 31\.10\.2026, /,
  );
  expect(screen.getByText('dns')).toBeInTheDocument();
  expect(screen.getByText(/^Checked 05\.10\.2026, [^.]+, ozon$/)).toBeInTheDocument();
});

test('offers the first product from an empty list, and keeps the header free of the button then', async (): Promise<void> => {
  stubGroups([]);
  renderPage();

  expect(await screen.findByText('Nothing is tracked yet.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/link/i)).not.toBeInTheDocument();

  await openForm();

  expect(screen.getByRole('dialog', { name: 'Track a product' })).toBeInTheDocument();
  expect(screen.getByLabelText(/link/i)).toBeInTheDocument();
});

test('closes the form once the product is added', async (): Promise<void> => {
  const sent: string[] = [];
  stubAdding(sent, 'added');
  renderPage();

  await openForm();
  await userEvent.type(screen.getByLabelText(/link/i), 'https://ozon.ru/t/AbC');
  await userEvent.click(screen.getByRole('button', { name: 'Track' }));

  await waitFor((): void => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  expect(sent).toEqual([JSON.stringify({ url: 'https://ozon.ru/t/AbC' })]);
});

test('keeps the form open and links the group of a product the user tracks already', async (): Promise<void> => {
  const sent: string[] = [];
  stubAdding(sent, 'tracked');
  renderPage();

  await openForm();
  await userEvent.type(screen.getByLabelText(/link/i), 'https://ozon.ru/t/AbC');
  await userEvent.click(screen.getByRole('button', { name: 'Track' }));

  const dialog = screen.getByRole('dialog', { name: 'Track a product' });
  expect(
    await within(dialog).findByText(/This product is tracked already in the group/),
  ).toBeInTheDocument();
  expect(await within(dialog).findByRole('link', { name: 'Old phone' })).toHaveAttribute(
    'href',
    `/groups/${trackedGroupId}`,
  );

  // A new link takes the note away.
  await userEvent.type(screen.getByLabelText(/link/i), '1');
  expect(within(dialog).queryByText(/tracked already/)).not.toBeInTheDocument();
});

test('closes the form when the add a reload cut short turns out to be done already', async (): Promise<void> => {
  const sent: string[] = [];
  stubAdding(sent, 'tracked');
  rememberPendingAdd({ url: 'https://ozon.ru/t/AbC', cityId: null, groupId: null });

  renderPage();

  await waitFor((): void => {
    expect(sent).toHaveLength(1);
  });
  await waitFor((): void => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

test('tells that adding a product can take minutes once it has taken over 5 seconds', async (): Promise<void> => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    stubAdding([]);
    renderPage();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await user.click(await screen.findByRole('button', { name: 'Add the first product' }));
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

test('opens the form by itself and sends again the link whose add was cut short by a reload', async (): Promise<void> => {
  const sent: string[] = [];
  stubAdding(sent);
  rememberPendingAdd({ url: 'https://ozon.ru/t/AbC', cityId: null, groupId: null });

  renderPage();

  expect(await screen.findByDisplayValue('https://ozon.ru/t/AbC')).toBeDisabled();
  await waitFor((): void => {
    expect(sent).toEqual([JSON.stringify({ url: 'https://ozon.ru/t/AbC' })]);
  });
});

test('leaves the form closed when the add cut short was to a group', async (): Promise<void> => {
  const sent: string[] = [];
  stubAdding(sent);
  rememberPendingAdd({
    url: 'https://ozon.ru/t/AbC',
    cityId: null,
    groupId: '22222222-2222-4222-8222-222222222222',
  });

  renderPage();

  expect(await screen.findByText('Nothing is tracked yet.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(sent).toEqual([]);
});

const dnsLink = 'https://www.dns-shop.ru/product/0463bb2411a1d582/156-noutbuk/';

test('asks for the city of a link of a marketplace that has cities, searches it by name, and sends its id', async (): Promise<void> => {
  const sent: string[] = [];
  const searched: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request | string | URL): Promise<Response> => {
      if (typeof request === 'string' || request instanceof URL) return pageOf([]);
      if (request.method === 'GET') {
        const { pathname, searchParams } = new URL(request.url);
        if (pathname === '/marketplaces/dns/cities') {
          searched.push(searchParams.get('query') ?? '');

          return Response.json({
            items: [{ id: 'irkutsk-id', name: 'Иркутск', region: 'Иркутская область' }],
          });
        }

        return pageOf([]);
      }

      sent.push(JSON.stringify(await request.json()));

      return new Promise<Response>(() => undefined);
    }),
  );
  renderPage();
  const user = userEvent.setup();

  await openForm();
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

const wildberriesLink = 'https://www.wildberries.ru/catalog/175088486/detail.aspx';

test('searches the cities of the marketplace of the link, and forgets a city of another one', async (): Promise<void> => {
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request | string | URL): Promise<Response> => {
      if (typeof request === 'string' || request instanceof URL) return pageOf([]);
      if (request.method === 'GET') {
        const { pathname } = new URL(request.url);
        if (pathname === '/marketplaces/dns/cities')
          return Response.json({ items: [{ id: 'dns-irkutsk', name: 'Иркутск', region: null }] });
        if (pathname === '/marketplaces/wildberries/cities')
          return Response.json({ items: [{ id: '-5827226', name: 'Иркутск', region: null }] });

        return pageOf([]);
      }

      sent.push(JSON.stringify(await request.json()));

      return new Promise<Response>(() => undefined);
    }),
  );
  renderPage();
  const user = userEvent.setup();

  await openForm();
  await user.type(screen.getByLabelText(/link/i), dnsLink);
  await user.type(screen.getByLabelText('City', { selector: 'input' }), 'Ирк');
  await user.click(await screen.findByRole('option', { name: /Иркутск/ }));
  await user.clear(screen.getByLabelText(/link/i));
  await user.type(screen.getByLabelText(/link/i), wildberriesLink);
  expect(screen.getByLabelText('City', { selector: 'input' })).toHaveValue('');

  await user.type(screen.getByLabelText('City', { selector: 'input' }), 'Ирк');
  await user.click(await screen.findByRole('option', { name: /Иркутск/ }));
  await user.click(screen.getByRole('button', { name: 'Track' }));

  await waitFor((): void => {
    expect(sent).toEqual([JSON.stringify({ url: wildberriesLink, cityId: '-5827226' })]);
  });
});

test('says the hub could not be reached when the request does not get there', async (): Promise<void> => {
  vi.stubGlobal(
    'fetch',
    vi.fn((): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'))),
  );

  renderPage();

  expect(await screen.findByText('The hub could not be reached.')).toBeInTheDocument();
  expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
});

test('sends the link whose add was cut short once, even when the page is mounted twice', async (): Promise<void> => {
  const sent: string[] = [];
  stubAdding(sent);
  rememberPendingAdd({ url: 'https://ozon.ru/t/AbC', cityId: null, groupId: null });

  renderPage(true);

  await waitFor((): void => {
    expect(sent).not.toHaveLength(0);
  });
  await act(() => Promise.resolve());

  expect(sent).toHaveLength(1);
});
