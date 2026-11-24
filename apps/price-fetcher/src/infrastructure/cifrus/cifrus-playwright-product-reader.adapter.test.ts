import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Camoufox } from 'camoufox-js';
import { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, BrowserContextOptions, Route } from 'playwright-core';
import { CifrusReferenceParser, ProductReferenceEntity } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { CifrusPageParser } from './cifrus-page.parser.js';
import {
  CifrusPlaywrightProductReaderAdapter,
  type CifrusReaderParsersInterface,
} from './cifrus-playwright-product-reader.adapter.js';
import { CifrusProductParser } from './cifrus-product.parser.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const reference = new ProductReferenceEntity(
  'cifrus',
  '1/apple_iphone_17_256gb_white_a3520',
  'https://www.cifrus.ru/description/1/apple_iphone_17_256gb_white_a3520',
);
const proxy = new ProxyEndpointEntity('socks5://217.71.230.103:1080');
const parsers: CifrusReaderParsersInterface = {
  geoIp: new GeoIpPageParser(),
  pages: new CifrusPageParser(),
  products: new CifrusProductParser(new CifrusReferenceParser()),
};

function productHtml(cityId: string, isAvailable: boolean): string {
  const price = cityId === '41910' ? '83150' : '77710';
  const offerAvailability = isAvailable
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';
  const stockHtml = isAvailable
    ? `<div class="product-price"><div class="price">Цена: <div class="new-price">${price} руб.</div></div></div>
       <div id="cart1"><a onclick="buy('1','23974','tok');">В корзину</a></div>`
    : `<div class="product-price"></div><span class="outstock">снят с продажи</span>`;

  return `
    <script>var CIFRUS_CITY = { name: 'Город', id: ${cityId}, hasUserSelected: true };</script>
    <div id="content">
      <div class="row" itemscope itemtype="https://schema.org/Product">
        <div itemprop="name" class="name"><h1>Apple iPhone 17 256Gb White (Белый) (A3520)</h1></div>
        <link itemprop="image" href="https://www.cifrus.ru/photos/little/apple/iphone-17.jpg" />
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="price" content="${price}" />
          <meta itemprop="priceCurrency" content="RUB" />
          <link itemprop="availability" href="${offerAvailability}" />
        </div>
        ${stockHtml}
      </div>
      <div itemscope itemtype="https://schema.org/ItemList">
        <div itemscope itemtype="https://schema.org/Product" itemprop="itemListElement">
          <h1>Related Product</h1>
          <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
            <meta itemprop="price" content="1000" />
            <meta itemprop="priceCurrency" content="RUB" />
            <link itemprop="availability" href="https://schema.org/InStock" />
          </div>
        </div>
      </div>
    </div>`;
}

function createReader(
  options: {
    country?: string;
    status?: number;
    isAvailable?: boolean;
    renderedCity?: string;
    challenge?: boolean;
  } = {},
  inspect?: {
    options?: (value: BrowserContextOptions | undefined) => void;
    cookie?: (value: string | null) => void;
  },
): CifrusPlaywrightProductReaderAdapter {
  return new CifrusPlaywrightProductReaderAdapter(
    {
      newContext: async (contextOptions?: BrowserContextOptions): Promise<BrowserContext> => {
        inspect?.options?.(contextOptions);
        const context = await browser.newContext(contextOptions);
        await context.route('**/*', async (route: Route): Promise<void> => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.hostname === 'ipinfo.io') {
            await route.fulfill({
              json: { ip: '217.71.230.103', country: options.country ?? 'RU' },
            });

            return;
          }

          if (
            url.origin === 'https://www.cifrus.ru' &&
            url.pathname === '/description/1/apple_iphone_17_256gb_white_a3520'
          ) {
            const cookieHeader = await request.headerValue('cookie');
            inspect?.cookie?.(cookieHeader);
            if (options.challenge === true) {
              await route.fulfill({
                status: 403,
                contentType: 'text/html; charset=utf-8',
                body: '<div class="g-recaptcha"></div><script>fetch("/unlock.php")</script>',
              });

              return;
            }
            if (options.status !== undefined) {
              await route.fulfill({ status: options.status, body: '' });

              return;
            }

            const cookieCity = /cdek_city_id=([^;]+)/.exec(cookieHeader ?? '')?.[1] ?? '74507';
            await route.fulfill({
              status: 200,
              contentType: 'text/html; charset=utf-8',
              body: productHtml(options.renderedCity ?? cookieCity, options.isAvailable ?? true),
            });

            return;
          }

          await route.abort();
        });

        return context;
      },
    },
    new CamoufoxOptionsFactory(),
    parsers,
    10_000,
  );
}

void test('sends city cookies, parses main product instead of related items, and returns success', async (): Promise<void> => {
  const cookies: string[] = [];
  const result = await createReader(
    {},
    {
      cookie: (value): void => {
        if (value !== null) cookies.push(value);
      },
    },
  ).read(reference.inCity('41910', 'Иркутск'), proxy, new AbortController().signal);

  assert.match(cookies[0] ?? '', /cdek_city_id=41910/);
  assert.match(cookies[0] ?? '', /cifrus_city_confirmed=1/);
  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.title, 'Apple iPhone 17 256Gb White (Белый) (A3520)');
  assert.deepEqual(result.snapshot.prices, [{ amountMinor: 8_315_000, currency: 'RUB' }]);
  assert.equal(result.snapshot.availability, 'in_stock');
  assert.equal(result.snapshot.imageUrl, 'https://www.cifrus.ru/photos/little/apple/iphone-17.jpg');
  assert.equal(result.exitIp, '217.71.230.103');
  assert.equal(browser.contexts().length, 0);
});

void test('falls back to Moscow when no city is given and marks out-of-stock product as partial', async (): Promise<void> => {
  const result = await createReader({ isAvailable: false }).read(
    reference,
    proxy,
    new AbortController().signal,
  );

  assert.equal(result.status, 'partial');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.availability, 'out_of_stock');
  assert.deepEqual(result.snapshot.prices, []);
});

void test('reports a 403 reCAPTCHA block page as challenge_required and HTTP errors otherwise', async (): Promise<void> => {
  const challenged = await createReader({ challenge: true }).read(
    reference,
    proxy,
    new AbortController().signal,
  );
  assert.deepEqual(challenged, { status: 'challenge_required' });

  const notFound = await createReader({ status: 404 }).read(
    reference,
    proxy,
    new AbortController().signal,
  );
  assert.deepEqual(notFound, { status: 'http_error', httpStatus: 404 });
});

void test('rejects non-RU proxy exit, mismatched city, and invalid cityId', async (): Promise<void> => {
  const wrongExit = await createReader({ country: 'US' }).read(
    reference,
    proxy,
    new AbortController().signal,
  );
  assert.deepEqual(wrongExit, { status: 'proxy_rejected', stage: 'exit' });

  const wrongCity = await createReader({ renderedCity: '74507' }).read(
    reference.inCity('41910', 'Иркутск'),
    proxy,
    new AbortController().signal,
  );
  assert.deepEqual(wrongCity, { status: 'parse_error' });

  const invalidCity = await createReader().read(
    reference.inCity('irkutsk', 'Иркутск'),
    proxy,
    new AbortController().signal,
  );
  assert.deepEqual(invalidCity, { status: 'parse_error' });
  assert.equal(browser.contexts().length, 0);
});

void test('reads directly when proxy is null', async (): Promise<void> => {
  let contextOptions: BrowserContextOptions | undefined;
  const reader = createReader(
    {},
    {
      options: (value): void => {
        contextOptions = value;
      },
    },
  );

  const result = await reader.read(reference, null, new AbortController().signal);

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.exitIp, null);
  assert.equal(contextOptions?.proxy, undefined);
  assert.equal(browser.contexts().length, 0);
});
