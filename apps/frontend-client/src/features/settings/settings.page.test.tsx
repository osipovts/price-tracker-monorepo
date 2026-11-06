import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { createI18n } from '../../i18n/i18n.js';
import { SettingsPage } from './settings.page.js';

const hubCalls: string[] = [];
const hubBodies: unknown[] = [];

interface AccountStubInterface {
  hasPassword: boolean;
  identities: Array<{ provider: 'google' | 'github'; linkedAt: string }>;
}

const passwordAndGoogle: AccountStubInterface = {
  hasPassword: true,
  identities: [
    { provider: 'google', linkedAt: '2026-10-30T10:00:00.000Z' },
    { provider: 'github', linkedAt: '2026-10-31T10:00:00.000Z' },
  ],
};

/** A hub that knows one user, signed in on two devices. */
function stubHub(account: AccountStubInterface = passwordAndGoogle): void {
  hubCalls.length = 0;
  hubBodies.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((request: Request): Promise<Response> => {
      const { pathname } = new URL(request.url);
      hubCalls.push(`${request.method} ${pathname}`);

      if (pathname === '/auth/me') {
        return Promise.resolve(
          Response.json({
            user: { id: 'u', email: 'jane@example.com', emailVerified: true, isAdmin: false },
          }),
        );
      }
      if (pathname === '/auth/account' && request.method === 'GET') {
        return Promise.resolve(
          Response.json({
            email: 'jane@example.com',
            emailVerified: true,
            createdAt: '2026-10-29T10:00:00.000Z',
            ...account,
          }),
        );
      }
      if (request.method === 'DELETE' && pathname === '/auth/account') {
        return request.json().then((body: unknown): Response => {
          hubBodies.push(body);

          return new Response(null, { status: 204 });
        });
      }
      if (pathname === '/auth/sessions' && request.method === 'GET') {
        const now = new Date().toISOString();
        const base = { ip: '203.0.113.7', createdAt: now, lastSeenAt: now, expiresAt: now };

        return Promise.resolve(
          Response.json({
            sessions: [
              {
                ...base,
                id: '11111111-1111-4111-8111-111111111111',
                current: true,
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36',
              },
              {
                ...base,
                id: '22222222-2222-4222-8222-222222222222',
                current: false,
                userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1',
              },
            ],
          }),
        );
      }

      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

function openSettings(): void {
  render(
    <MantineProvider defaultColorScheme="auto">
      <MemoryRouter>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <SettingsPage />
        </QueryClientProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach((): void => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ru-RU', 'en-US']);
  localStorage.clear();
  createI18n('en');
  stubHub();
});

afterEach((): void => {
  localStorage.clear();
});

test('the theme that is picked is kept by the browser', async (): Promise<void> => {
  openSettings();
  const theme = screen.getByRole('radiogroup', { name: 'Theme' });

  await userEvent.click(within(theme).getByText('Dark'));

  expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'dark');
  expect(localStorage.getItem('mantine-color-scheme-value')).toBe('dark');
});

test('the language that is picked is used at once and kept by the browser', async (): Promise<void> => {
  openSettings();
  const language = screen.getByRole('radiogroup', { name: 'Language' });

  await userEvent.click(within(language).getByText('RU'));

  expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument();
  expect(localStorage.getItem('language')).toBe('ru');
});

test('auto forgets the pick and follows the languages of the browser', async (): Promise<void> => {
  localStorage.setItem('language', 'en');
  openSettings();
  const language = screen.getByRole('radiogroup', { name: 'Language' });

  await userEvent.click(within(language).getByText('Auto'));

  // The browser asks for Russian first.
  expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument();
  expect(localStorage.getItem('language')).toBeNull();
});

test('shows who is signed in, and on which devices', async (): Promise<void> => {
  openSettings();

  expect(await screen.findByText('jane@example.com')).toBeInTheDocument();
  expect(screen.getByText('confirmed')).toBeInTheDocument();
  expect(await screen.findByText('Chrome, Linux')).toBeInTheDocument();
  expect(screen.getByText('this device')).toBeInTheDocument();
  expect(screen.getByText('Safari, iPhone')).toBeInTheDocument();
});

test('signs a device out, and all the others at once', async (): Promise<void> => {
  openSettings();
  await screen.findByText('Safari, iPhone');

  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(hubCalls).toContain('DELETE /auth/sessions/22222222-2222-4222-8222-222222222222');

  await userEvent.click(screen.getByRole('button', { name: 'Sign out the other devices' }));
  expect(hubCalls).toContain('DELETE /auth/sessions');
});

test('changes the password with the current one', async (): Promise<void> => {
  openSettings();

  await userEvent.type(await screen.findByLabelText(/Current password/), 'old-password-1');
  await userEvent.type(screen.getByLabelText(/New password/), 'new-password-2');
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

  expect(await screen.findByText('The password is changed.')).toBeInTheDocument();
  expect(hubCalls).toContain('POST /auth/password');
});

test('shows the password and the providers linked, and unlinks one of them', async (): Promise<void> => {
  openSettings();

  expect(await screen.findByRole('heading', { name: 'Sign-in methods' })).toBeInTheDocument();
  expect(await screen.findByText('Google')).toBeInTheDocument();
  expect(screen.getByText('GitHub')).toBeInTheDocument();
  // The password is a row like the others: its name and the day the account was created.
  const section = (
    await screen.findByRole('heading', { name: 'Sign-in methods' })
  ).closest<HTMLElement>('.mantine-Card-root');
  if (section === null) throw new Error('The section of the linked accounts is not a card');
  expect(within(section).getByText('Password')).toBeInTheDocument();
  expect(within(section).getByText(/^Created: /)).toBeInTheDocument();

  const unlinkButtons = await screen.findAllByRole('button', { name: 'Unlink' });
  expect(unlinkButtons).toHaveLength(2);
  const github = unlinkButtons[1];
  if (github === undefined) throw new Error('No button to unlink GitHub');
  await userEvent.click(github);

  expect(hubCalls).toContain('DELETE /auth/identities/github');
});

test('does not let the last way to log in go', async (): Promise<void> => {
  stubHub({
    hasPassword: false,
    identities: [{ provider: 'google', linkedAt: '2026-10-30T10:00:00.000Z' }],
  });
  openSettings();

  expect(await screen.findByText('The only way to log in')).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Unlink' })).toBeDisabled();
});

test('deletes the account only once its email is written', async (): Promise<void> => {
  openSettings();

  await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
  const submit = await screen.findByRole('button', { name: 'Delete the account for good' });
  expect(submit).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Email of the account'), 'someone@example.com');
  expect(submit).toBeDisabled();

  await userEvent.clear(screen.getByLabelText('Email of the account'));
  await userEvent.type(screen.getByLabelText('Email of the account'), 'Jane@Example.com');
  expect(submit).toBeEnabled();
  await userEvent.click(submit);

  expect(hubCalls).toContain('DELETE /auth/account');
  expect(hubBodies).toEqual([{ email: 'Jane@Example.com' }]);
});

test('asks for the email again when the confirmation is closed and opened anew', async (): Promise<void> => {
  openSettings();

  await userEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
  await userEvent.type(await screen.findByLabelText('Email of the account'), 'Jane@Example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));

  expect(await screen.findByLabelText('Email of the account')).toHaveValue('');
});

test('links to the legal texts at the foot of the settings', async (): Promise<void> => {
  openSettings();

  expect(await screen.findByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
    'href',
    '/privacy',
  );
  expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
});
