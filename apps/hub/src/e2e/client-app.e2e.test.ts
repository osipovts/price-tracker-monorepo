import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { type Browser, chromium, devices, type Page } from 'playwright';
import { DnsReferenceParser } from 'product-reference';

import { HttpImageDownloaderAdapter } from '../product/infrastructure/http-image-downloader.adapter.js';
import { DockerStackAdapter } from './support/docker-stack.adapter.js';
import { FakePriceWorkerAdapter } from './support/fake-price-worker.adapter.js';
import {
  connectDatabase,
  type RunningHubInterface,
  seedProxies,
  startHub,
} from './support/hub-harness.js';
import { ImageServerAdapter, onePixelPng } from './support/image-server.adapter.js';

/**
 * The client app as a person uses it: the built app in a real Chromium, served by the real hub over a real
 * Postgres and Redis, with the price worker the one stand-in (as in the price tests). The app must be built
 * first (`pnpm --filter frontend-client build`).
 */
const stack = new DockerStackAdapter();
const email = 'jane@example.com';
const password = 'correct-horse';
const productUrl = 'https://www.ozon.ru/product/4775581891/';
const dnsLink = 'https://www.dns-shop.ru/product/0463bb2411a1d582/156-noutbuk/';
/** The address the hub keeps the DNS product under, which the worker is told the price of. */
const dnsUrl = new DnsReferenceParser().parse(new URL(dnsLink))?.url ?? dnsLink;
let hub: RunningHubInterface;
let worker: FakePriceWorkerAdapter;
const marketplace = new ImageServerAdapter();
let database: ReturnType<typeof connectDatabase>;
let browser: Browser;
let page: Page;

/** The email, the settings and the way out are in one menu of the header: it is opened to reach any of them. */
async function openAccountMenu(on: Page): Promise<void> {
  await on.getByRole('button', { name: 'Account', exact: true }).click();
}

before(
  async (): Promise<void> => {
    const infrastructure = await stack.start({ s3: true });
    database = connectDatabase(infrastructure.databaseUrl);
    await seedProxies(database, ['socks5://217.71.230.1:1080']);

    worker = new FakePriceWorkerAdapter(infrastructure.redisUrl);
    worker.setPrice(productUrl, 129_900);
    worker.setPrice(dnsUrl, 119_900);
    // The page of the product names a picture, which the marketplace serves.
    marketplace.serve('/thumb.png', 'image/png', onePixelPng);
    worker.setImage(productUrl, `${await marketplace.start()}/thumb.png`);
    worker.start();

    hub = await startHub({
      stack: infrastructure,
      // The marketplace of the test is a server on this machine, over plain HTTP.
      imageDownloader: new HttpImageDownloaderAdapter({
        protocols: ['http:'],
        allows: (): boolean => true,
      }),
      env: {
        // The default schedule, 50 minutes after the last read, which the page shows (the harness turns it off).
        PRICE_REFRESH_AFTER_MS: '3000000',
        CLIENT_UI_DIR: resolve(import.meta.dirname, '../../../frontend-client/dist'),
      },
    });
    browser = await chromium.launch();
    page = await (await browser.newContext()).newPage();
  },
  { timeout: 120_000 },
);

after(
  async (): Promise<void> => {
    await browser.close();
    await hub.stop();
    await worker.stop();
    await marketplace.stop();
    await database.$disconnect();
    await stack.stop();
  },
  { timeout: 60_000 },
);

void test('a visitor signs up, and is logged in', async (): Promise<void> => {
  await page.goto(`${hub.baseUrl}/app/`);
  await page.waitForURL('**/app/login');

  await page.getByRole('heading', { name: 'Нищебродская' }).waitFor();
  await page.getByText('price tracker: ozon, wb, dns, etc.', { exact: true }).waitFor();

  await page.getByRole('tab', { name: 'Sign up' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign up' }).click();

  await page.getByRole('heading', { name: 'Products' }).waitFor();
  await page.getByRole('button', { name: 'Account', exact: true }).waitFor();

  // Under the field of the link: what can be tracked. One page of products has no paginator.
  await page.getByText('Supported marketplaces: ozon.ru, dns-shop.ru').waitFor();
  assert.equal(await page.locator('.mantine-Pagination-root').count(), 0);
});

void test('a product is added by its link, and shows its first price when a worker has read it', async (): Promise<void> => {
  await page.getByLabel('Link to a product').fill(productUrl);
  await page.getByRole('button', { name: 'Track' }).click();

  // The list follows the job by itself: no reload.
  await page.getByText(/1\s299,00/).waitFor({ timeout: 20_000 });
  assert.equal(worker.jobs.length, 1);

  // The price is the best of the group, with the marketplace it is on, and the day it was seen.
  const now = page.getByTestId('price-Now');
  await now.getByText('ozon', { exact: true }).waitFor();
  await now.getByText(/^today, /).waitFor();
  assert.equal(await database.productGroup.count(), 1);

  // The picture is kept by the hub in S3 and handed out by an address that is signed.
  // The first write to the storage can take a while: the picture comes after the price.
  const picture = page.locator('main img').first();
  await picture.waitFor({ timeout: 60_000 });
  const address = (await picture.getAttribute('src')) ?? '';
  assert.match(address, /\/thumbnails\/products\/.+\/thumbnail\?.*X-Amz-Signature=/);
  const loaded = await fetch(address);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await loaded.arrayBuffer()), onePixelPng);
  assert.equal(
    (await fetch(address.replace('X-Amz-Signature=', 'X-Amz-Signature=00'))).status,
    403,
  );
  assert.equal((await fetch(address.split('?')[0] ?? '')).status, 403);

  // The marketplace was asked for it once.
  assert.deepEqual(marketplace.requests, ['/thumb.png']);
});

void test('a long title takes two lines of its card at most, and is whole in its hint', async (): Promise<void> => {
  const longTitle = `ASUS ${'ROG Strix gaming laptop with a very long name '.repeat(12)}`.trim();
  const original = (await database.priceObservation.findFirstOrThrow()).title;
  await database.priceObservation.updateMany({ data: { title: longTitle } });
  await page.reload();

  const link = page.getByRole('link', { name: /ASUS ROG/ });
  await link.waitFor();
  assert.equal(await link.getAttribute('title'), longTitle);

  const box = await link.boundingBox();
  assert.ok(box);
  // Two lines of a font of 16 pixels, and a title that is cut.
  assert.ok(box.height < 60, `the title is ${String(box.height)} pixels high`);
  assert.ok(await link.evaluate((node): boolean => node.scrollHeight > node.clientHeight));

  // The next tests read the page of the product, where a title this long would push the charts down.
  await database.priceObservation.updateMany({ data: { title: original } });
});

void test('the page of the group has the products, two charts side by side, and the history', async (): Promise<void> => {
  // Older prices with gaps between them, as the schedule would have left in a day.
  const product = await database.trackedProduct.findFirstOrThrow();
  const group = await database.productGroup.findFirstOrThrow();
  const hoursAgo = (hours: number): Date => new Date(Date.now() - hours * 3_600_000);
  await database.priceObservation.createMany({
    data: [6, 4].map((hours) => ({
      trackedProductId: product.id,
      jobId: randomUUID(),
      title: 'ASUS',
      observedAt: hoursAgo(hours),
      availability: 'in_stock',
      prices: [{ amountMinor: 100_000 + hours * 1000, currency: 'RUB' }],
    })),
  });

  await page.getByRole('link', { name: /.+/ }).filter({ hasText: /\S/ }).first().waitFor();
  await page.goto(`${hub.baseUrl}/app/groups/${group.id}`);
  await page
    .getByTestId('price-Now')
    .getByText(/1\s299,00/)
    .waitFor();
  // Only the time of day: the price is read within the hour.
  await page.getByText(/Next price check: about \d{1,2}:\d{2}/).waitFor();

  const charts = page.locator('.recharts-wrapper');
  await charts.nth(1).waitFor();
  assert.equal(await charts.count(), 2);

  // Side by side: the same row, and each takes half of it.
  const [first, second] = await Promise.all([
    charts.nth(0).boundingBox(),
    charts.nth(1).boundingBox(),
  ]);
  assert.ok(first && second);
  assert.ok(Math.abs(first.y - second.y) < 2);
  assert.ok(Math.abs(first.width - second.width) < 40);
  assert.ok(second.x > first.x + first.width / 2);

  // The hours with no price are drawn dashed.
  assert.ok((await page.locator('.recharts-line-curve[stroke-dasharray]').count()) >= 1);

  // The history lists all three prices.
  assert.equal(await page.locator('tbody tr').count(), 3);
});

void test('the hint of a point tells the average, the lowest and the highest price of the product, or the last known one', async (): Promise<void> => {
  const chart = page.locator('.recharts-wrapper').nth(0);
  // The products and the form of the group are above it: the pointer must be on the screen.
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  assert.ok(box);
  const tooltip = page.locator('.recharts-tooltip-wrapper').first();
  const hover = async (fromRight: number): Promise<void> => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width - fromRight, box.y + box.height / 2, { steps: 10 });
  };

  // The right edge of the chart is the current hour, where the price of the worker is.
  await hover(18);
  await tooltip.getByText(/ozon: average .*\(min .*, max .*\)/).waitFor();

  // The hour before it had no price: the hint says what was known last.
  await hover(27);
  await tooltip.getByText(/ozon: Last known/).waitFor();
});

void test('a product of another marketplace joins the group: the best price is the cheaper one, and the charts get a second line', async (): Promise<void> => {
  const group = await database.productGroup.findFirstOrThrow();
  await page.goto(`${hub.baseUrl}/app/groups/${group.id}`);

  await page.getByLabel('Link to a product').fill(dnsLink);
  await page.getByRole('button', { name: 'Track' }).click();

  const now = page.getByTestId('price-Now');
  await now.getByText('dns', { exact: true }).waitFor({ timeout: 20_000 });
  await now.getByText(/1\s199,00/).waitFor();
  // Dearer than the lowest price of the day (the older reads of the other product): not highlighted.
  assert.equal(await now.locator('[data-highlighted="true"]').count(), 0);
  await page
    .getByTestId('price-Lowest')
    .getByText(/1\s040,00/)
    .waitFor();
  assert.equal(await page.getByText('Products in the group: 2').count(), 1);
  assert.equal(await database.productGroup.count(), 1);
  assert.equal((await database.productGroupItem.findMany()).length, 2);

  // The legend names both lines, in the colours of the badges.
  const charts = page.locator('.recharts-wrapper');
  await charts.nth(1).waitFor();
  for (const name of ['ozon', 'dns']) {
    assert.equal(await page.locator('.recharts-legend-wrapper').first().getByText(name).count(), 1);
  }
  const blue = page
    .getByText('ozon', { exact: true })
    .locator('xpath=ancestor-or-self::*[contains(@class, "mantine-Badge-root")]')
    .first();
  const orange = page
    .getByText('dns', { exact: true })
    .locator('xpath=ancestor-or-self::*[contains(@class, "mantine-Badge-root")]')
    .first();
  const colorOf = (badge: typeof blue): Promise<string> =>
    badge.evaluate((node): string => getComputedStyle(node).backgroundColor);
  assert.notEqual(await colorOf(blue), await colorOf(orange));

  // The badges are as wide as one another.
  const widths = await page
    .locator('.mantine-Badge-root')
    .evaluateAll((nodes): number[] =>
      nodes
        .filter((node) => ['ozon', 'dns'].includes(node.textContent))
        .map((node) => Math.round(node.getBoundingClientRect().width)),
    );
  assert.ok(widths.length >= 3);
  assert.equal(new Set(widths).size, 1);

  // The period of the lowest and the highest price is kept by the hub.
  await page.goto(`${hub.baseUrl}/app/`);
  await page.getByText('7 days', { exact: true }).click();
  await page.waitForFunction(
    (): boolean => document.querySelector('input[value="7d"]:checked') !== null,
  );
  await page.reload();
  await page.waitForFunction(
    (): boolean => document.querySelector('input[value="7d"]:checked') !== null,
  );
});

void test('on a phone the list is cards and nothing is wider than the screen', async (): Promise<void> => {
  const group = await database.productGroup.findFirstOrThrow();
  const phone = await browser.newContext({
    ...devices['iPhone 12'],
    storageState: await page.context().storageState(),
  });
  const screen = await phone.newPage();
  const widerThanScreen = (): Promise<boolean> =>
    screen.evaluate((): boolean => document.documentElement.scrollWidth > window.innerWidth);

  await screen.goto(`${hub.baseUrl}/app/`);
  await screen
    .getByRole('link', { name: /Product|ASUS/ })
    .first()
    .waitFor();
  assert.equal(await screen.locator('table').count(), 0);

  // The lines of a card are one under another, and the button is at the right of the title.
  const card = screen.locator('main .mantine-Card-root').filter({ hasText: 'Lowest' }).first();
  const lines = [
    card.getByRole('link'),
    card.getByTestId('price-Now'),
    card.getByTestId('price-Lowest'),
    card.getByTestId('price-Highest'),
  ];
  let bottom = -1;
  for (const line of lines) {
    const box = await line.boundingBox();
    assert.ok(box);
    assert.ok(box.y >= bottom - 1, 'a line is under the one before it');
    bottom = box.y + box.height;
  }
  const [title, remove] = await Promise.all([
    card.getByRole('link').boundingBox(),
    card.getByRole('button', { name: 'Delete' }).boundingBox(),
  ]);
  assert.ok(title && remove);
  assert.ok(remove.x > title.x + title.width - 1, 'the button is at the right of the title');
  assert.ok(
    remove.y < title.y + title.height && remove.y + remove.height > title.y,
    'the button is on the line of the title',
  );
  assert.equal(await widerThanScreen(), false);

  await screen.goto(`${hub.baseUrl}/app/groups/${group.id}`);
  await screen.locator('.recharts-wrapper').nth(1).waitFor();
  assert.equal(await widerThanScreen(), false);

  // The two charts are one under the other, each as wide as the content.
  const [first, second] = await Promise.all([
    screen.locator('.recharts-wrapper').nth(0).boundingBox(),
    screen.locator('.recharts-wrapper').nth(1).boundingBox(),
  ]);
  assert.ok(first && second);
  assert.ok(second.y > first.y + first.height - 2);
  await phone.close();
});

void test('a group is deleted from its card after a confirmation, and its products go for good with their last tracker', async (): Promise<void> => {
  assert.equal(await database.trackedProduct.count(), 2);

  // The page of the group has a cross for the group and one for each of its products.
  const group = await database.productGroup.findFirstOrThrow();
  await page.goto(`${hub.baseUrl}/app/groups/${group.id}`);
  await page.getByTestId('price-Now').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Delete' }).count(), 3);

  await page.goto(`${hub.baseUrl}/app/`);
  await page.getByRole('button', { name: 'Delete' }).click();
  // Asked first: nothing is gone before the confirmation.
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await database.trackedProduct.count(), 2);

  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();

  await page.getByText('Nothing is tracked yet.').waitFor();
  assert.equal(await database.trackedProduct.count(), 0);
  assert.equal(await database.productGroup.count(), 0);
});

void test('the theme and the language are set on the page of the settings, and kept by the browser', async (): Promise<void> => {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings', level: 2 }).waitFor();

  // The note that the settings are kept by the browser is gone, and the sign-out of the others is a red button.
  assert.equal(await page.getByText('Kept in this browser').count(), 0);

  // The password is listed among the ways to log in, with the day the account was made.
  await page.getByRole('heading', { name: 'Linked accounts' }).waitFor();
  const linked = page
    .locator('.mantine-Card-root')
    .filter({ has: page.getByRole('heading', { name: 'Linked accounts' }) });
  await linked.getByText('Password', { exact: true }).waitFor();
  await linked.getByText(/^Created: /).waitFor();

  // Nothing of the kind is in the header any more.
  assert.equal(await page.locator('header').getByText('Dark').count(), 0);

  await page.getByRole('radiogroup', { name: 'Theme' }).getByText('Dark').click();
  assert.equal(await page.locator('html').getAttribute('data-mantine-color-scheme'), 'dark');

  await page.getByRole('radiogroup', { name: 'Language' }).getByText('RU', { exact: true }).click();
  await page.getByRole('heading', { name: 'Настройки', level: 2 }).waitFor();

  // Both survive a reload.
  await page.reload();
  await page.getByRole('heading', { name: 'Настройки', level: 2 }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-mantine-color-scheme'), 'dark');
  assert.equal(await page.evaluate((): string | null => localStorage.getItem('language')), 'ru');

  // Auto goes back to the browser, which asks for English here.
  await page.getByRole('radiogroup', { name: 'Язык' }).getByText('Авто').click();
  await page.getByRole('heading', { name: 'Settings', level: 2 }).waitFor();
  assert.equal(await page.evaluate((): string | null => localStorage.getItem('language')), null);
});

void test('the settings show the account and the devices, and sign the other devices out', async (): Promise<void> => {
  await page.goto(`${hub.baseUrl}/app/settings`);
  await page.getByRole('heading', { name: 'Account', level: 4, exact: true }).waitFor();
  // The email of the account is the label of the menu.
  await openAccountMenu(page);
  await page.getByRole('menu').getByText(email, { exact: true }).waitFor();
  await page.keyboard.press('Escape');

  // The same person on a second device.
  const other = await browser.newContext();
  const login = await other.request.post(`${hub.baseUrl}/auth/login`, {
    data: { email, password },
    headers: { origin: hub.baseUrl },
  });
  assert.equal(login.status(), 200);
  assert.equal((await other.request.get(`${hub.baseUrl}/auth/me`)).status(), 200);

  await page.reload();
  await page.getByText('this device').waitFor();
  await page.getByRole('button', { name: 'Sign out the other devices' }).click();
  await page
    .getByRole('button', { name: 'Sign out the other devices' })
    .waitFor({ state: 'detached' });

  assert.equal((await other.request.get(`${hub.baseUrl}/auth/me`)).status(), 401);
  assert.equal((await page.request.get(`${hub.baseUrl}/auth/me`)).status(), 200);
  await other.close();
});

void test('the password is changed with the current one, and the old one stops working', async (): Promise<void> => {
  const newPassword = 'a-new-horse-battery';

  await page.getByLabel(/Current password/).fill('not-the-password');
  await page.getByLabel(/New password/).fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByRole('alert').waitFor();

  await page.getByLabel(/Current password/).fill(password);
  await page.getByRole('button', { name: 'Change password' }).click();
  await page.getByText('The password is changed.').waitFor();

  const check = await browser.newContext();
  const attempt = (secret: string): Promise<number> =>
    check.request
      .post(`${hub.baseUrl}/auth/login`, {
        data: { email, password: secret },
        headers: { origin: hub.baseUrl },
      })
      .then((reply): number => reply.status());
  assert.equal(await attempt(password), 401);
  assert.equal(await attempt(newPassword), 200);
  await check.close();
});

void test('a visitor who logs out is sent to the login', async (): Promise<void> => {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Log out' }).click();
  await page.waitForURL('**/app/login');
});

void test('the language follows the browser, and the login page has no switch of it', async (): Promise<void> => {
  // A browser that asks for Russian sends `Accept-Language: ru-RU` and reports it to the page.
  const context = await browser.newContext({ locale: 'ru-RU' });
  const russian = await context.newPage();
  await russian.goto(`${hub.baseUrl}/app/login`);
  await russian.getByText('трекер цен: ozon, wb, dns, и др.', { exact: true }).waitFor();
  assert.equal(await russian.locator('html').getAttribute('lang'), 'ru');

  // The language is picked on the page of the settings, not here: no switch on the login page, nor on the legal texts.
  assert.equal(await russian.getByRole('radiogroup').count(), 0);
  await russian.goto(`${hub.baseUrl}/app/privacy`);
  await russian.getByRole('heading', { level: 1, name: 'Политика конфиденциальности' }).waitFor();
  assert.equal(await russian.getByRole('radiogroup').count(), 0);
  await context.close();

  // A browser with a language the app has no words in gets English.
  const german = await browser.newContext({ locale: 'de-DE' });
  const other = await german.newPage();
  await other.goto(`${hub.baseUrl}/app/login`);
  await other.getByText('price tracker: ozon, wb, dns, etc.', { exact: true }).waitFor();
  await german.close();
});

void test('the privacy policy and the terms are open without a login, and linked at the foot of the login page', async (): Promise<void> => {
  const context = await browser.newContext();
  const visitor = await context.newPage();

  await visitor.goto(`${hub.baseUrl}/app/login`);
  await visitor.getByRole('link', { name: 'Privacy Policy' }).click();
  await visitor.waitForURL('**/app/privacy');
  await visitor.getByRole('heading', { level: 1, name: 'Privacy Policy' }).waitFor();
  await visitor.getByText(/Limited Use requirements/).waitFor();

  // By the address, with no page of the app before it: this is what the consent screen of Google links to.
  await visitor.goto(`${hub.baseUrl}/app/terms`);
  await visitor.getByRole('heading', { level: 1, name: 'Terms of Service' }).waitFor();
  assert.equal(new URL(visitor.url()).pathname, '/app/terms');

  // And in Russian for a browser that asks for it.
  const russian = await browser.newContext({ locale: 'ru-RU' });
  const page = await russian.newPage();
  await page.goto(`${hub.baseUrl}/app/privacy`);
  await page.getByRole('heading', { level: 1, name: 'Политика конфиденциальности' }).waitFor();

  await context.close();
  await russian.close();
});
