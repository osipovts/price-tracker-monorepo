import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { type Browser, chromium } from 'playwright';

import type { OauthProviderType } from '../account/application/index.js';
import type { OauthProviderPort } from '../auth/application/oauth-provider.port.js';
import { GithubOauthProviderAdapter } from '../auth/infrastructure/github-oauth-provider.adapter.js';
import { GoogleOauthProviderAdapter } from '../auth/infrastructure/google-oauth-provider.adapter.js';
import { DockerStackAdapter } from './support/docker-stack.adapter.js';
import { FakeIdentityProviderAdapter } from './support/fake-identity-provider.adapter.js';
import { type RunningHubInterface, startHub } from './support/hub-harness.js';

/**
 * The buttons of the login through Google and GitHub in the client app, in a real Chromium: the browser
 * follows the real redirects to a server of ours that stands in for the providers, and back to the hub.
 */
const stack = new DockerStackAdapter();
const provider = new FakeIdentityProviderAdapter();
let hub: RunningHubInterface;
let browser: Browser;

before(
  async (): Promise<void> => {
    const [infrastructure] = await Promise.all([stack.start(), provider.start()]);
    const credentials = { clientId: provider.clientId, clientSecret: provider.clientSecret };
    const providers = new Map<OauthProviderType, OauthProviderPort>();
    providers.set(
      'google',
      new GoogleOauthProviderAdapter(credentials, provider.googleEndpoints()),
    );
    providers.set(
      'github',
      new GithubOauthProviderAdapter(credentials, provider.githubEndpoints()),
    );

    hub = await startHub({
      stack: infrastructure,
      oauthProviders: providers,
      env: {
        CLIENT_UI_DIR: resolve(import.meta.dirname, '../../../frontend-client/dist'),
        // The user lands in the app: after a login, and after one that failed.
        AUTH_SUCCESS_REDIRECT: '/app/',
        AUTH_FAILURE_REDIRECT: '/app/login',
      },
    });
    browser = await chromium.launch();
  },
  { timeout: 120_000 },
);

after(
  async (): Promise<void> => {
    await browser.close();
    await hub.stop();
    await provider.stop();
    await stack.stop();
  },
  { timeout: 60_000 },
);

void test('the login page offers both providers, and a login through one lands the user in the app', async (): Promise<void> => {
  provider.deny = false;
  provider.profile = { subject: '2001', email: 'jane@example.com', emailVerified: true };
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${hub.baseUrl}/app/login`);
  await page.getByRole('link', { name: 'Continue with GitHub' }).waitFor();
  // Each button has the mark of its provider.
  assert.equal(
    await page.getByRole('link', { name: 'Continue with Google' }).locator('svg').count(),
    1,
  );
  assert.equal(
    await page.getByRole('link', { name: 'Continue with GitHub' }).locator('svg').count(),
    1,
  );
  await page.getByRole('link', { name: 'Continue with Google' }).click();

  await page.waitForURL(/\/app\/?$/);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('menu').getByText('jane@example.com', { exact: true }).waitFor();
  await context.close();
});

void test('a login that the user refuses at the provider brings them back to the login page, with the reason', async (): Promise<void> => {
  provider.deny = true;
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${hub.baseUrl}/app/login`);
  await page.getByRole('link', { name: 'Continue with Google' }).click();

  await page.waitForURL(/\/app\/login\?error=oauth/);
  await page.getByText('The login through the provider failed').waitFor();
  assert.equal((await page.request.get(`${hub.baseUrl}/auth/me`)).status(), 401);
  await context.close();
  provider.deny = false;
});

void test('a first login through GitHub signs a new user up, and they are in the app too', async (): Promise<void> => {
  provider.profile = { subject: '3001', email: 'sam@example.com', emailVerified: true };
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`${hub.baseUrl}/app/login`);
  await page.getByRole('link', { name: 'Continue with GitHub' }).click();

  await page.waitForURL(/\/app\/?$/);
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('menu').getByText('sam@example.com', { exact: true }).waitFor();
  await context.close();
});

void test('the settings show the account linked, refuse to unlink the only way in, and delete the account', async (): Promise<void> => {
  provider.profile = { subject: '4001', email: 'dana@example.com', emailVerified: true };
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${hub.baseUrl}/app/login`);
  await page.getByRole('link', { name: 'Continue with GitHub' }).click();
  await page.waitForURL(/\/app\/?$/);

  await page.goto(`${hub.baseUrl}/app/settings`);
  await page.getByRole('heading', { name: 'Sign-in methods' }).waitFor();
  await page.getByText('The only way to log in').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Unlink' }).isDisabled(), true);

  await page.getByRole('button', { name: 'Delete account' }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Delete the account for good' });
  assert.equal(await confirm.isDisabled(), true);
  await dialog.getByLabel('Email of the account').fill('dana@example.com');
  await confirm.click();

  await page.waitForURL('**/app/login');
  assert.equal((await page.request.get(`${hub.baseUrl}/auth/me`)).status(), 401);
  await context.close();
});
