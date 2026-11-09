import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';

import { JobsPage } from './jobs.page.js';

let queries: string[] = [];

function job(n: number, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `3f0c9a52-7a53-4a64-9d0d-${String(n).padStart(12, '0')}`,
    kind: 'price_fetch',
    subject: 'ozon',
    status: 'completed',
    percent: 100,
    processed: 1,
    total: 1,
    succeeded: 1,
    error: null,
    createdAt: '2026-11-10T10:00:00.000Z',
    startedAt: '2026-11-10T10:00:01.000Z',
    finishedAt: '2026-11-10T10:00:31.000Z',
    lost: false,
    product: null,
    ...extra,
  };
}

const jobs = [
  job(1, {
    status: 'running',
    percent: 50,
    processed: 2,
    total: 4,
    succeeded: 1,
    subject: 'wildberries',
    finishedAt: null,
  }),
  job(2, {
    subject: '22222222-2222-4222-8222-222222222222',
    product: {
      id: '22222222-2222-4222-8222-222222222222',
      marketplace: 'dns',
      url: 'https://www.dns-shop.ru/product/1/',
      cityName: 'Иркутск',
      title: 'Notebook ASUS',
    },
  }),
  job(3, {
    kind: 'proxy_fetch',
    subject: 'proxifly',
    status: 'failed',
    error: 'The source did not answer',
  }),
  job(4, {
    kind: 'handbook_fetch',
    subject: 'dns-cities',
    status: 'queued',
    lost: true,
    startedAt: null,
    finishedAt: null,
  }),
];

beforeEach((): void => {
  queries = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request): Promise<Response> => {
      const { searchParams } = new URL(request.url);
      queries.push(searchParams.toString());

      return Promise.resolve(Response.json({ items: jobs, page: 1, pageSize: 25, total: 4 }));
    }),
  );
});

function renderPage(path = '/jobs'): void {
  render(
    <MantineProvider env="test">
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <JobsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

test('shows each job with its status, what it is about, how far it is and why it failed', async (): Promise<void> => {
  renderPage();

  const running = (await screen.findByText('Batch of wb')).closest('tr');
  if (running === null) throw new Error('no row of the batch');
  expect(within(running).getByText('running')).toBeInTheDocument();
  expect(within(running).getByRole('progressbar')).toBeInTheDocument();
  expect(within(running).getByText('2 of 4, 1 succeeded')).toBeInTheDocument();

  expect(screen.getByRole('link', { name: 'Notebook ASUS' })).toHaveAttribute(
    'href',
    'https://www.dns-shop.ru/product/1/',
  );
  expect(screen.getByText('Иркутск')).toBeInTheDocument();
  expect(screen.getByText('The source did not answer')).toBeInTheDocument();
  expect(screen.getByText('lost')).toBeInTheDocument();
  expect(screen.getAllByText('30 s')).toHaveLength(2);
});

test('takes the filter from the address, and asks the hub for the failures of a kind from the first page', async (): Promise<void> => {
  renderPage('/jobs?state=failed');

  await screen.findByText('Batch of wb');
  expect(queries.at(-1)).toBe('page=1&pageSize=25&state=failed');

  await userEvent.click(screen.getByText('On their way'));
  await waitFor((): void => {
    expect(queries.at(-1)).toBe('page=1&pageSize=25&state=active');
  });
});

test('opens a job with all the hub knows of it', async (): Promise<void> => {
  renderPage();

  await userEvent.click(await screen.findByText('proxifly'));

  const drawer = await screen.findByRole('dialog');
  expect(within(drawer).getByText('proxifly')).toBeInTheDocument();
  expect(within(drawer).getByText('The source did not answer')).toBeInTheDocument();
  expect(within(drawer).getByText('3f0c9a52-7a53-4a64-9d0d-000000000003')).toBeInTheDocument();
});
