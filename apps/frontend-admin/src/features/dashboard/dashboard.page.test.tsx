import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';

import { DashboardPage } from './dashboard.page.js';

function counts(kind: string, completed: number, failed: number): object {
  return { kind, queued: 0, running: 0, retrying: 0, completed, failed };
}

function dashboardOf(lost = 0): Record<string, unknown> {
  return {
    generatedAt: '2026-11-10T12:30:00.000Z',
    users: { total: 12, verified: 9, joinedLastDay: 2 },
    products: {
      products: 30,
      trackings: 41,
      groups: 17,
      staleAfterMs: 3 * 3_600_000,
      marketplaces: [
        {
          marketplace: 'ozon',
          products: 20,
          readsLastDay: 300,
          lastReadAt: '2026-11-10T12:20:00.000Z',
          stale: 2,
          unread: 1,
        },
        {
          marketplace: 'dns',
          products: 10,
          readsLastDay: 5,
          lastReadAt: null,
          stale: 4,
          unread: 0,
        },
      ],
      readsByHour: [{ hour: '2026-11-10T12:00:00.000Z', marketplace: 'ozon', reads: 9 }],
    },
    proxies: {
      total: 80,
      alive: 25,
      disabled: 3,
      averageLatencyMs: 250,
      lastCheckedAt: '2026-11-01T10:00:00.000Z',
      bySource: [],
      usable: [
        { marketplace: 'ozon', count: 14 },
        { marketplace: 'dns', count: 0 },
      ],
    },
    jobs: {
      lastDay: [
        counts('price_fetch', 75, 25),
        counts('proxy_fetch', 5, 0),
        counts('handbook_fetch', 1, 0),
      ],
      unfinished: { queued: 4, running: 2, retrying: 1, lost },
      priceJobsByHour: [{ hour: '2026-11-10T12:00:00.000Z', completed: 7, failed: 1 }],
    },
  };
}

/** The hub answers the dashboard as given, and the failed jobs with these. */
function stubHub(answer: Response, failures: Array<Record<string, unknown>> = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request): Promise<Response> =>
      Promise.resolve(
        new URL(request.url).pathname === '/admin/jobs'
          ? Response.json({ items: failures, page: 1, pageSize: 5, total: failures.length })
          : answer.clone(),
      ),
    ),
  );
}

function renderPage(): void {
  render(
    <MantineProvider env="test">
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <DashboardPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

test('puts first whether the prices are read: the reads, the stale prices, the queue, the proxies and the users', async () => {
  stubHub(Response.json(dashboardOf()));
  renderPage();

  expect(await screen.findByText('305')).toBeInTheDocument();
  expect(screen.getByText('75% of the reads succeeded')).toBeInTheDocument();
  expect(screen.getByText('6')).toBeInTheDocument();
  expect(screen.getByText('Not read for over 3 h; never read: 1')).toBeInTheDocument();
  expect(screen.getByText('2 running, 4 queued, 1 retrying')).toBeInTheDocument();
  expect(screen.getByText('25 / 80')).toBeInTheDocument();
  expect(screen.getByText('9 confirmed, 2 new in a day, 17 groups')).toBeInTheDocument();
  expect(screen.queryByText(/lost/)).not.toBeInTheDocument();
  expect(await screen.findByText('None.')).toBeInTheDocument();
});

test('tells for each marketplace its reads, its stale prices and the proxies its reads may take', async () => {
  stubHub(Response.json(dashboardOf()));
  renderPage();

  const dns = (await screen.findAllByRole('row')).find(
    (row): boolean => within(row).queryByText('dns') !== null,
  );
  if (dns === undefined) throw new Error('no row of dns');
  expect(
    within(dns)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['dns', '10', '5', '-', '4', '0', '0']);
});

test('warns of the lost jobs, and lists the recent failures with a way to all of them', async () => {
  stubHub(Response.json(dashboardOf(3)), [
    {
      id: '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11',
      kind: 'price_fetch',
      subject: '22222222-2222-4222-8222-222222222222',
      status: 'failed',
      percent: 0,
      processed: 1,
      total: 1,
      succeeded: 0,
      error: 'No route answered',
      createdAt: '2026-11-01T08:59:00.000Z',
      startedAt: '2026-11-01T08:59:01.000Z',
      finishedAt: '2026-11-01T09:00:00.000Z',
      lost: false,
      product: {
        id: '22222222-2222-4222-8222-222222222222',
        marketplace: 'ozon',
        url: 'https://www.ozon.ru/product/1/',
        cityName: null,
        title: 'Notebook ASUS',
      },
    },
  ]);
  renderPage();

  expect(await screen.findByText('3 lost')).toBeInTheDocument();
  expect(await screen.findByText('No route answered')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Notebook ASUS' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'All failures' })).toHaveAttribute(
    'href',
    '/jobs?state=failed',
  );
});

test('shows the error of the hub', async () => {
  stubHub(Response.json({ message: 'Not an administrator' }, { status: 403 }));
  renderPage();

  expect(await screen.findByRole('alert')).toHaveTextContent('Not an administrator');
});
