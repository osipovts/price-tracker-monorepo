import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect, test, vi } from 'vitest';

import { AdminShell } from './admin-shell.component.js';

test('the name of the app is followed by the panel and the version of the release, and every section is a link', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn((): Promise<Response> =>
      Promise.resolve(Response.json({ message: 'no' }, { status: 401 })),
    ),
  );
  const router = createMemoryRouter([{ path: '/', element: <AdminShell /> }]);
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );

  const title = screen.getByRole('heading', { level: 4 });
  expect(title).toHaveTextContent('Нищебродская');
  expect(title.nextElementSibling).toHaveTextContent(`admin v${APP_VERSION}`);
  expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  for (const section of ['Dashboard', 'Jobs', 'Groups', 'Proxies', 'Handbooks']) {
    expect(screen.getByRole('link', { name: section })).toBeInTheDocument();
  }
});
