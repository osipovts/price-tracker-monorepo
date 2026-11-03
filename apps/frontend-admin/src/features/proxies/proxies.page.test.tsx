import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { ProxiesPage } from './proxies.page.js';

const pageSize = 20;
let servers: string[] = [];
/** What the hub was asked, as `METHOD path?query`, without the reads of the list. */
let writes: string[] = [];
let lastListQuery = '';

function proxy(server: string): Record<string, unknown> {
  return {
    server,
    source: 'proxifly',
    country: null,
    alive: true,
    latencyMs: 120,
    successRate: 1,
    checksTotal: 3,
    lastCheckedAt: '2026-11-01T10:00:00.000Z',
    disabled: false,
    reputations:
      server === 'http://10.0.0.0:80'
        ? [
            {
              marketplace: 'ozon',
              successes: 1,
              failures: 2.5,
              failureStreak: 2,
              lastOutcome: 'blocked',
              lastAttemptAt: '2026-11-03T08:00:00.000Z',
              cooldownUntil: '2999-01-01T00:00:00.000Z',
            },
          ]
        : [],
  };
}

beforeEach((): void => {
  writes = [];
  servers = Array.from(
    { length: pageSize + 1 },
    (_, index): string => `http://10.0.0.${String(index)}:80`,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request): Promise<Response> => {
      const { pathname, searchParams } = new URL(request.url);

      if (request.method !== 'GET') {
        writes.push(
          `${request.method} ${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`,
        );
      }
      if (pathname === '/proxies' && request.method === 'GET') {
        lastListQuery = searchParams.toString();
        const page = Number(searchParams.get('page'));

        return Promise.resolve(
          Response.json({
            items: servers.slice((page - 1) * pageSize, page * pageSize).map(proxy),
            page,
            pageSize,
            total: servers.length,
          }),
        );
      }
      if (pathname === '/proxies' && request.method === 'DELETE') {
        servers = servers.filter((server): boolean => server !== searchParams.get('server'));

        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (
        (pathname === '/proxies' && ['PATCH', 'POST'].includes(request.method)) ||
        (pathname === '/proxies/all' && request.method === 'DELETE')
      ) {
        if (pathname === '/proxies/all') servers = [];

        return Promise.resolve(
          new Response(null, { status: request.method === 'POST' ? 201 : 204 }),
        );
      }
      if (pathname === '/jobs') {
        return Promise.resolve(Response.json({ items: [], page: 1, pageSize: 100, total: 0 }));
      }

      return Promise.resolve(Response.json({}, { status: 404 }));
    }),
  );
});

function renderPage(): void {
  render(
    <MantineProvider env="test">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <ProxiesPage />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function deleteFirstProxy(user: UserEvent): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Delete' }));
  await user.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }),
  );
}

test('goes back a page when the last proxy of the last page is deleted', async (): Promise<void> => {
  renderPage();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '2' }));
  await deleteFirstProxy(user);

  expect(await screen.findByText('http://10.0.0.0:80')).toBeInTheDocument();
});

test('stays on the first page when the only proxy is deleted', async (): Promise<void> => {
  servers = ['http://10.0.0.0:80'];
  renderPage();
  await deleteFirstProxy(userEvent.setup());

  expect(await screen.findByText('No proxies match.')).toBeInTheDocument();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.every(
        ([request]): boolean => request instanceof Request && !request.url.includes('page=0'),
      ),
  ).toBe(true);
});

test('tells how a proxy has done reading a marketplace, and until when it rests', async (): Promise<void> => {
  renderPage();

  const badge = await screen.findByText('ozon 1/2.5');
  await userEvent.hover(badge);

  expect(
    await screen.findByText(
      /Failures in a row: 2\. The last attempt: turned away by the marketplace/,
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/Not given for this marketplace until/)).toBeInTheDocument();
});

test('turns a proxy off with its switch', async (): Promise<void> => {
  renderPage();

  await userEvent.click(await screen.findByLabelText('Enabled http://10.0.0.0:80'));

  expect(writes).toContain('PATCH /proxies?server=http%3A%2F%2F10.0.0.0%3A80');
});

test('asks for the dead proxies only, from the first page', async (): Promise<void> => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: '2' }));
  await screen.findByText('http://10.0.0.20:80');

  await userEvent.click(screen.getByText('Dead'));

  await waitFor((): void => {
    expect(lastListQuery).toContain('alive=false');
  });
  expect(lastListQuery).toContain('page=1');
});

test('adds a proxy by hand with the address trimmed, and closes the dialog', async (): Promise<void> => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Add proxy' }));
  const dialog = await screen.findByRole('dialog');

  await userEvent.type(within(dialog).getByRole('textbox'), '  socks5://203.0.113.10:1080 ');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add proxy' }));

  await waitFor((): void => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  expect(writes).toContain('POST /proxies');
});

test('deletes all the proxies after a confirmation', async (): Promise<void> => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Delete all' }));
  const dialog = await screen.findByRole('dialog');

  await userEvent.click(within(dialog).getByRole('button', { name: 'Delete all' }));

  expect(await screen.findByText('No proxies match.')).toBeInTheDocument();
  expect(writes).toContain('DELETE /proxies/all');
});
