import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';

import { ClientShell } from './client-shell.component.js';

let calls: string[] = [];

function stubHub(emailVerified: boolean, isAdmin = false): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request): Promise<Response> => {
      const { pathname } = new URL(request.url);
      calls.push(`${request.method} ${pathname}`);
      if (pathname === '/auth/me') {
        return Promise.resolve(
          Response.json({
            user: { id: 'u', email: 'jane@example.com', emailVerified, isAdmin },
          }),
        );
      }

      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

function openShell(): void {
  const router = createMemoryRouter(
    [
      {
        element: <ClientShell />,
        children: [{ index: true, element: <p>The list</p> }],
      },
      { path: '/login', element: <p>Login page</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <MantineProvider env="test">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

beforeEach((): void => {
  calls = [];
});

test('shows the page in its frame, and no reminder to a user whose email is confirmed', async () => {
  stubHub(true);
  openShell();

  expect(await screen.findByText('The list')).toBeInTheDocument();
  await waitFor(() => {
    expect(calls).toContain('GET /auth/me');
  });
  expect(screen.queryByText('Confirm your email')).not.toBeInTheDocument();
});

test('reminds a user whose email is not confirmed, and sends the link again on request', async () => {
  stubHub(false);
  openShell();

  expect(await screen.findByText('We sent a link to jane@example.com.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Send again' }));

  expect(await screen.findByRole('button', { name: 'Sent' })).toBeDisabled();
  expect(calls).toContain('POST /auth/verify-email/resend');
});

test('logs out from the menu of the account, and goes to the login page', async () => {
  stubHub(true);
  openShell();

  await userEvent.click(await screen.findByRole('button', { name: 'Account' }));
  expect(await screen.findByText('jane@example.com')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

  expect(await screen.findByText('Login page')).toBeInTheDocument();
  expect(calls).toContain('POST /auth/logout');
});

test('tells the version of the app in the hint of its name, and leaves the legal links to the settings', async () => {
  stubHub(true);
  openShell();

  expect(await screen.findByRole('link', { name: 'Нищебродская' })).toHaveAttribute(
    'title',
    `v${APP_VERSION}`,
  );
  expect(screen.queryByRole('link', { name: 'Privacy Policy' })).not.toBeInTheDocument();
  expect(screen.queryByText(`v${APP_VERSION}`)).not.toBeInTheDocument();
});

test('leads an administrator to the admin panel from the menu of the account, and nobody else', async () => {
  stubHub(true, true);
  openShell();
  await userEvent.click(await screen.findByRole('button', { name: 'Account' }));

  expect(await screen.findByRole('menuitem', { name: 'Admin panel' })).toHaveAttribute(
    'href',
    '/panel/',
  );
});

test('has no way to the admin panel for a user who is no administrator', async () => {
  stubHub(true);
  openShell();
  await userEvent.click(await screen.findByRole('button', { name: 'Account' }));

  expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Admin panel' })).not.toBeInTheDocument();
});
