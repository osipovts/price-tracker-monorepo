import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { HandbooksPage } from './handbooks.page.js';

const jobId = '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a11';
const irkutsk = {
  id: '30b7c1f1-03fb-11dc-95ee-00151716f9f5',
  name: 'Иркутск',
  region: 'Иркутская область',
};

interface HubInterface {
  requests: string[];
  /** What the hub says of the job once it is asked. */
  job: { status: string; processed: number; total: number };
  fetchedAt: string | null;
  cities: Array<{ id: string; name: string; region: string | null }>;
  running: Array<{ id: string; status: string }>;
}

const hub: HubInterface = {
  requests: [],
  job: { status: 'running', processed: 12, total: 30 },
  fetchedAt: '2026-11-01T10:00:00.000Z',
  cities: [irkutsk],
  running: [],
};

function job(id: string): Record<string, unknown> {
  return {
    id,
    kind: 'handbook_fetch',
    subject: 'dns-cities',
    status: hub.job.status,
    processed: hub.job.processed,
    total: hub.job.total,
    succeeded: hub.job.processed,
    percent: Math.round((hub.job.processed / hub.job.total) * 100),
    error: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  };
}

beforeEach((): void => {
  hub.requests = [];
  hub.job = { status: 'running', processed: 12, total: 30 };
  hub.fetchedAt = '2026-11-01T10:00:00.000Z';
  hub.cities = [irkutsk];
  hub.running = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request): Promise<Response> => {
      const { pathname, searchParams } = new URL(request.url);
      hub.requests.push(
        `${request.method} ${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`,
      );

      if (pathname === '/handbooks/wildberries-cities' && request.method === 'GET') {
        return Promise.resolve(
          Response.json({
            items: [{ id: '-5827226', name: 'Иркутск', region: 'Иркутская обл.' }],
            page: 1,
            pageSize: 20,
            total: 1,
            fetchedAt: hub.fetchedAt,
          }),
        );
      }
      if (pathname === '/handbooks/dns-cities' && request.method === 'GET') {
        return Promise.resolve(
          Response.json({
            items: hub.cities,
            page: 1,
            pageSize: 20,
            total: hub.cities.length,
            fetchedAt: hub.fetchedAt,
          }),
        );
      }
      if (pathname === '/handbooks/dns-cities/refresh') {
        return Promise.resolve(Response.json({ jobId }, { status: 202 }));
      }
      if (pathname === '/jobs') {
        return Promise.resolve(
          Response.json({
            items: hub.running.map(({ id, status }) => ({ ...job(id), status })),
            page: 1,
            pageSize: 100,
            total: hub.running.length,
          }),
        );
      }
      if (pathname === `/jobs/${jobId}`) return Promise.resolve(Response.json(job(jobId)));

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
        <HandbooksPage />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

test('shows the cities of DNS and when they were read', async (): Promise<void> => {
  renderPage();

  expect(await screen.findByText('Иркутск')).toBeInTheDocument();
  expect(screen.getByText('Иркутская область')).toBeInTheDocument();
  expect(screen.getByText(irkutsk.id)).toBeInTheDocument();
  expect(screen.getByText(/Updated:/)).toBeInTheDocument();
  expect(hub.requests).toContain('GET /handbooks/dns-cities?page=1&pageSize=20&query=');
});

test('says the cities were never read, with nothing in the table', async (): Promise<void> => {
  hub.fetchedAt = null;
  hub.cities = [];
  renderPage();

  expect(await screen.findByText('Never read')).toBeInTheDocument();
  expect(screen.getByText('No cities.')).toBeInTheDocument();
});

test('asks for a new read, follows its job, and shows the cities again when it is done', async (): Promise<void> => {
  renderPage();
  const user = userEvent.setup();
  await screen.findByText('Иркутск');

  await user.click(screen.getByRole('button', { name: 'Refresh' }));

  expect(await screen.findByLabelText('Progress of the read')).toBeInTheDocument();
  expect(await screen.findByText('40%')).toBeInTheDocument();
  expect(hub.requests).toContain('POST /handbooks/dns-cities/refresh');

  hub.job = { status: 'completed', processed: 30, total: 30 };
  hub.cities = [irkutsk, { id: 'b', name: 'Ангарск', region: 'Иркутская область' }];
  expect(await screen.findByText('Ангарск', {}, { timeout: 4000 })).toBeInTheDocument();
  expect(screen.getByText('completed')).toBeInTheDocument();
});

test('follows a read that is still running when the page is opened', async (): Promise<void> => {
  hub.running = [{ id: jobId, status: 'running' }];
  renderPage();

  expect(await screen.findByLabelText('Progress of the read')).toBeInTheDocument();
  await waitFor((): void => {
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});

test('shows the cities of Wildberries on their own tab, with the region of each as its id', async (): Promise<void> => {
  renderPage();
  const user = userEvent.setup();
  await screen.findByText(irkutsk.id);

  await user.click(screen.getByRole('tab', { name: 'Cities of Wildberries' }));

  expect(await screen.findByText('-5827226')).toBeInTheDocument();
  expect(screen.getByText('Region (dest) on wildberries.ru')).toBeInTheDocument();
  expect(screen.queryByText(irkutsk.id)).not.toBeInTheDocument();
  expect(hub.requests).toContain('GET /handbooks/wildberries-cities?page=1&pageSize=20&query=');
});
