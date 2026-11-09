import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import { ProxiesPage } from './proxies.page.js';

const pageSize = 20;
let servers: string[] = [];
/** What the hub was asked to change, as `METHOD path?query`. */
let writes: string[] = [];
let listQueries: string[] = [];
/** The proxy jobs the hub knows, the newest first. */
let proxyJobs: Array<Record<string, unknown>> = [];

function proxy(server: string): Record<string, unknown> {
  return {
    server,
    source: 'proxifly',
    country: null,
    exitIp: null,
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
            {
              marketplace: 'wildberries',
              successes: 3,
              failures: 0,
              failureStreak: 0,
              lastOutcome: 'read',
              lastAttemptAt: '2026-11-03T08:00:00.000Z',
              cooldownUntil: null,
            },
          ]
        : [],
  };
}

function proxyJob(
  source: string,
  status: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `3f0c9a52-7a53-4a64-9d0d-${String(proxyJobs.length).padStart(12, '0')}`,
    kind: 'proxy_fetch',
    subject: source,
    status,
    percent: 40,
    processed: 40,
    total: 100,
    succeeded: 7,
    error: null,
    createdAt: '2026-11-10T10:00:00.000Z',
    startedAt: '2026-11-10T10:00:01.000Z',
    finishedAt: null,
    lost: false,
    product: null,
    ...extra,
  };
}

const stats = {
  total: 21,
  alive: 20,
  disabled: 1,
  averageLatencyMs: 120,
  lastCheckedAt: '2026-11-01T10:00:00.000Z',
  bySource: [
    { source: 'manual', total: 1, alive: 1, disabled: 0 },
    { source: 'proxifly', total: 20, alive: 19, disabled: 1 },
  ],
  usable: [
    { marketplace: 'ozon', count: 12 },
    { marketplace: 'dns', count: 0 },
    { marketplace: 'wildberries', count: 9 },
    { marketplace: 'citilink', count: 11 },
  ],
};

beforeEach((): void => {
  writes = [];
  listQueries = [];
  proxyJobs = [];
  servers = Array.from(
    { length: pageSize + 1 },
    (_, index): string => `http://10.0.0.${String(index)}:80`,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request): Promise<Response> => {
      const { pathname, searchParams } = new URL(request.url);
      const query = searchParams.size > 0 ? `?${searchParams.toString()}` : '';

      if (request.method !== 'GET') {
        writes.push(`${request.method} ${pathname}${query}`);

        return Promise.resolve(
          pathname.startsWith('/proxy-sources/')
            ? Response.json({ jobId: '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a99' }, { status: 202 })
            : new Response(null, { status: 204 }),
        );
      }
      if (pathname === '/proxies') {
        listQueries.push(searchParams.toString());
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
      if (pathname === '/proxies/stats') return Promise.resolve(Response.json(stats));
      if (pathname === '/admin/jobs') {
        return Promise.resolve(
          Response.json({ items: proxyJobs, page: 1, pageSize: 50, total: proxyJobs.length }),
        );
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

test('tells how many proxies a read of each marketplace may take now, and what each source gave', async (): Promise<void> => {
  renderPage();

  expect(await screen.findByText('20 alive, 1 turned off')).toBeInTheDocument();
  expect(screen.getByText('12')).toBeInTheDocument();
  const sources = screen.getByRole('table', { name: 'Sources' });
  expect(within(sources).getByText('added by hand')).toBeInTheDocument();
  const proxifly = within(sources).getByRole('row', { name: /^proxifly/ });
  expect(within(proxifly).getByText('19')).toBeInTheDocument();
  expect(within(proxifly).getByText('never')).toBeInTheDocument();
});

test('follows the refresh of a source that runs, whoever started it, and shows its proxies when it ends', async (): Promise<void> => {
  proxyJobs = [proxyJob('proxifly', 'running')];
  renderPage();

  expect(
    await screen.findByRole('progressbar', { name: 'Refresh of proxifly' }),
  ).toBeInTheDocument();
  expect(screen.getByText('7 alive of 40 checked')).toBeInTheDocument();
  const listed = listQueries.length;

  proxyJobs = [
    proxyJob('proxifly', 'completed', {
      percent: 100,
      processed: 100,
      succeeded: 30,
      finishedAt: '2026-11-10T10:05:00.000Z',
    }),
  ];

  expect(
    await screen.findByText('30 alive of 100 checked', {}, { timeout: 4000 }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('progressbar', { name: 'Refresh of proxifly' }),
  ).not.toBeInTheDocument();
  await waitFor((): void => {
    expect(listQueries.length).toBeGreaterThan(listed);
  });
});

test('refreshes one source with its button', async (): Promise<void> => {
  renderPage();

  await userEvent.click(await screen.findByRole('button', { name: 'Refresh geonode' }));

  await waitFor((): void => {
    expect(writes).toEqual(['POST /proxy-sources/geonode/refresh']);
  });
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
  // A marketplace with a long name goes by its short one.
  expect(screen.getByText('wb 3/0')).toBeInTheDocument();
});

test('turns a proxy off with its switch, and deletes none', async (): Promise<void> => {
  renderPage();

  await userEvent.click(await screen.findByLabelText('Enabled http://10.0.0.0:80'));

  expect(writes).toContain('PATCH /proxies?server=http%3A%2F%2F10.0.0.0%3A80');
  expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
});

test('asks for the working proxies, then for those of one source, from the first page', async (): Promise<void> => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: '2' }));
  await screen.findByText('http://10.0.0.20:80');

  await userEvent.click(screen.getByText('Working'));
  await waitFor((): void => {
    expect(listQueries.at(-1)).toBe('page=1&pageSize=20&alive=true&disabled=false');
  });

  // The select labels its list too: the field is the input.
  const field = screen
    .getAllByLabelText('Source')
    .find((element): boolean => element.tagName === 'INPUT');
  if (field === undefined) throw new Error('no field of the source');
  await userEvent.click(field);
  await userEvent.click(await screen.findByRole('option', { name: 'added by hand' }));
  await waitFor((): void => {
    expect(listQueries.at(-1)).toBe('page=1&pageSize=20&alive=true&disabled=false&source=manual');
  });
});

test('adds a proxy by hand with the address trimmed, and closes the dialog', async (): Promise<void> => {
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Add by hand' }));
  const dialog = await screen.findByRole('dialog');

  await userEvent.type(within(dialog).getByRole('textbox'), '  socks5://203.0.113.10:1080 ');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add by hand' }));

  await waitFor((): void => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  expect(writes).toContain('POST /proxies');
});
