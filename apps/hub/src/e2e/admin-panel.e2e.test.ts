import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { z } from 'zod';

import { DockerStackAdapter } from './support/docker-stack.adapter.js';
import {
  connectDatabase,
  eventually,
  type RunningHubInterface,
  seedProxies,
  startHub,
} from './support/hub-harness.js';

/**
 * The admin panel as a person uses it: the built panel in a real Chromium, served by the real hub over a
 * real Postgres and Redis. The panel must be built first (`pnpm --filter frontend-admin build`).
 */
const stack = new DockerStackAdapter();
const adminEmail = 'root@example.com';
const userEmail = 'jane@example.com';
const password = 'correct-horse';
const servers = ['socks5://217.71.230.1:1080', 'socks5://217.71.230.2:1080'];
let hub: RunningHubInterface;
let database: ReturnType<typeof connectDatabase>;
let browser: Browser;

before(
  async (): Promise<void> => {
    const infrastructure = await stack.start();
    database = connectDatabase(infrastructure.databaseUrl);
    await seedProxies(database, servers);

    hub = await startHub({
      stack: infrastructure,
      env: {
        ADMIN_EMAILS: adminEmail,
        ADMIN_UI_DIR: resolve(import.meta.dirname, '../../../frontend-admin/dist'),
        CLIENT_UI_DIR: resolve(import.meta.dirname, '../../../frontend-client/dist'),
      },
    });
    for (const email of [adminEmail, userEmail]) {
      const client = hub.browser();
      await client.request('/auth/register', { json: { email, password } });
      // The mail is not the thing under test here: the address is proven the way the link would.
      await database.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
    }

    browser = await chromium.launch();
  },
  { timeout: 120_000 },
);

after(
  async (): Promise<void> => {
    await browser.close();
    await hub.stop();
    await database.$disconnect();
    await stack.stop();
  },
  { timeout: 60_000 },
);

async function logIn(context: BrowserContext, email: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${hub.baseUrl}/panel/`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  return page;
}

void test('a visitor is sent to the login, and a wrong password is refused', async (): Promise<void> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${hub.baseUrl}/panel/`);
  await page.waitForURL('**/panel/login');

  await page.getByLabel('Email').fill(adminEmail);
  await page.getByRole('textbox', { name: 'Password' }).fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  await page.getByText('The email or the password is wrong.').waitFor();
  await context.close();
});

void test('a user who is no administrator is told the panel is not theirs', async (): Promise<void> => {
  const context = await browser.newContext();
  const page = await logIn(context, userEmail);

  await page.getByText('No access').waitFor();
  assert.equal(await page.getByText('Proxies alive').count(), 0);

  // Out of the panel the API does not let them in either.
  const reply = await page.request.get(`${hub.baseUrl}/admin/dashboard`);
  assert.equal(reply.status(), 403);
  await context.close();
});

void test('an administrator sees the dashboard, then works with the proxies', async (): Promise<void> => {
  const context = await browser.newContext();
  const page = await logIn(context, adminEmail);

  await page.getByText('Proxies alive').waitFor();
  await page.getByText('2 / 2').waitFor();

  await page.getByRole('link', { name: 'Proxies' }).click();
  await page.getByText(servers[0] ?? '').waitFor();
  await page.getByText(servers[1] ?? '').waitFor();

  // Two proxies are one page: there is no paginator.
  assert.equal(await page.locator('.mantine-Pagination-root').count(), 0);

  // Turned off: the hub keeps the proxy away from the workers, and the list says so.
  await page
    .getByRole('row', { name: new RegExp(servers[0] ?? '') })
    .locator('.mantine-Switch-track')
    .click();
  await eventually(async () => {
    const reply = await page.request.get(`${hub.baseUrl}/proxies?disabled=true`);
    const body = z
      .object({ items: z.array(z.object({ server: z.string() })) })
      .parse(await reply.json());

    return body.items.length === 1 ? body : null;
  }, 'the proxy turned off');

  // A proxy is turned off, never deleted.
  assert.equal(await page.getByRole('button', { name: /Delete/ }).count(), 0);
  assert.equal(await database.proxy.count(), 2);

  // A refresh of a source is a job the page follows; no worker takes it here, so it waits in the queue.
  await page.getByRole('button', { name: 'Refresh proxifly' }).click();
  await page
    .getByRole('table', { name: 'Sources' })
    .getByRole('row', { name: /^proxifly/ })
    .getByText('queued')
    .waitFor();

  // The jobs tell it too.
  await page.getByRole('link', { name: 'Jobs' }).click();
  await page.getByRole('cell', { name: 'proxifly' }).first().waitFor();

  // The dashboard follows what was done.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByText('1 turned off').waitFor();
  await context.close();
});

void test('an administrator sees the groups of the users, and opens one in the app read-only', async (): Promise<void> => {
  const jane = await database.user.findUniqueOrThrow({ where: { email: userEmail } });
  const product = await database.trackedProduct.create({
    data: {
      marketplace: 'ozon',
      externalId: '4775581891',
      url: 'https://www.ozon.ru/product/4775581891/',
      cityId: 'moskva',
      cityName: 'Москва',
    },
  });
  await database.productSubscription.create({
    data: { userId: jane.id, trackedProductId: product.id },
  });
  const group = await database.productGroup.create({
    data: { userId: jane.id, title: 'Phone of Jane' },
  });
  await database.productGroupItem.create({
    data: { userId: jane.id, trackedProductId: product.id, groupId: group.id },
  });
  await database.priceObservation.create({
    data: {
      trackedProductId: product.id,
      jobId: randomUUID(),
      title: 'Phone',
      observedAt: new Date(),
      availability: 'in_stock',
      prices: [{ amountMinor: 100_000, currency: 'RUB' }],
    },
  });

  const context = await browser.newContext();
  const page = await logIn(context, adminEmail);
  await page.getByRole('link', { name: 'Groups' }).click();
  const row = page.getByRole('row', { name: /Phone of Jane/ });
  await row.getByText(userEmail).waitFor();

  const [view] = await Promise.all([
    context.waitForEvent('page'),
    row.getByRole('link', { name: 'Open' }).click(),
  ]);
  await view.getByRole('heading', { name: 'Phone of Jane' }).waitFor();
  await view.getByText('The group of a user').waitFor();
  assert.equal(await view.getByRole('button', { name: 'Add' }).count(), 0);
  assert.equal(await view.getByRole('button', { name: 'Stop tracking' }).count(), 0);

  // The app and the panel lead to each other: the menu of an administrator has the panel.
  await view.getByRole('button', { name: 'Account' }).click();
  await view.getByRole('menuitem', { name: 'Admin panel' }).click();
  await view.getByText('Proxies alive').waitFor();
  await view.getByRole('link', { name: 'Open the app' }).click();
  await view.waitForURL('**/app/');
  await context.close();

  // The owner is no administrator: the view of the administrators is not theirs.
  const own = await browser.newContext();
  const path = `${hub.baseUrl}/admin/product-groups/${group.id}`;
  assert.equal((await own.request.get(path)).status(), 401);
  await own.request.post(`${hub.baseUrl}/auth/login`, {
    data: { email: userEmail, password },
    headers: { origin: hub.baseUrl },
  });
  assert.equal((await own.request.get(path)).status(), 403);
  await own.close();
});

void test('the panel is shut off from frames', async (): Promise<void> => {
  const reply = await fetch(`${hub.baseUrl}/panel/`);

  assert.equal(reply.headers.get('x-frame-options'), 'DENY');
});

void test('the panel speaks the language of the browser', async (): Promise<void> => {
  const context = await browser.newContext({ locale: 'ru-RU' });
  const page = await context.newPage();
  await page.goto(`${hub.baseUrl}/panel/login`);

  await page.getByRole('heading', { name: 'Админка' }).waitFor();
  await context.close();
});
