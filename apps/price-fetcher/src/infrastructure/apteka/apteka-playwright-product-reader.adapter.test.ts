import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Camoufox } from 'camoufox-js';
import { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, BrowserContextOptions, Route } from 'playwright-core';
import { AptekaReferenceParser, ProductReferenceEntity } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { AptekaPageParser } from './apteka-page.parser.js';
import {
  AptekaPlaywrightProductReaderAdapter,
  type AptekaReaderParsersInterface,
} from './apteka-playwright-product-reader.adapter.js';
import { AptekaProductParser } from './apteka-product.parser.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const reference = new ProductReferenceEntity(
  'apteka',
  '5e32674d65b5ab0001650ab2',
  'https://apteka.ru/product/5e32674d65b5ab0001650ab2/',
);
const proxy = new ProxyEndpointEntity('socks5://217.71.230.103:1080');
const parsers: AptekaReaderParsersInterface = {
  geoIp: new GeoIpPageParser(),
  pages: new AptekaPageParser(),
  products: new AptekaProductParser(new AptekaReferenceParser()),
};

function productHtml(cityId: string, isAvailable: boolean): string {
  const state = {
    selectedCity: { id: 'city-obj-id', url: cityId },
    product: {
      groupItems: [
        {
          itemInfos: [
            {
              id: reference.id,
              name: 'Йодомарин 200 50 шт. таблетки',
              price: isAvailable ? 141 : 0,
              lastPrice: 148,
              outOfStock: !isAvailable,
              mediaWithUids: [{ photoUrl: '3c1bcf4a-d96f-49d9-9831-d2cf19238f5f.webp' }],
            },
          ],
        },
      ],
    },
  };

  // Apteka.ru Vue hydration deletes window.__INITIAL_STATE__ and its script tag from the DOM.
  return [
    `<script id="init-state">window.__INITIAL_STATE__=${JSON.stringify(state)};</script>`,
    '<script type="application/ld+json">{"@type":"Product"}</script>',
    '<script>delete window.__INITIAL_STATE__;document.getElementById("init-state")?.remove();</script>',
  ].join('');
}

function challengeHtml(reload: boolean): string {
  return `<script src="/__qrator/qauth.js"></script><div id="captcha-img"></div>${
    reload ? '<script>setTimeout(() => location.reload(), 10)</script>' : ''
  }`;
}

function createReader(
  options: {
    country?: string;
    status?: number;
    isAvailable?: boolean;
    renderedCity?: string;
    challenge?: 'once' | 'always' | 'never';
  } = {},
  inspectOptions?: (options: BrowserContextOptions | undefined) => void,
): AptekaPlaywrightProductReaderAdapter {
  let challenged = false;

  return new AptekaPlaywrightProductReaderAdapter(
    {
      newContext: async (contextOptions?: BrowserContextOptions): Promise<BrowserContext> => {
        inspectOptions?.(contextOptions);
        const context = await browser.newContext(contextOptions);

        await context.route('**/*', async (route: Route): Promise<void> => {
          const url = new URL(route.request().url());
          if (url.hostname === 'ipinfo.io') {
            await route.fulfill({
              json: { ip: '217.71.230.103', country: options.country ?? 'RU' },
            });

            return;
          }

          const productMatch = /^\/([a-z0-9_-]+)\/product\/(?:[\w%-]+-)?([0-9a-f]{24})\/$/.exec(
            url.pathname,
          );
          if (url.origin === 'https://apteka.ru' && productMatch?.[1] !== undefined) {
            const challenge = options.challenge ?? 'never';
            if (challenge === 'always' || (challenge === 'once' && !challenged)) {
              challenged = true;
              await route.fulfill({
                status: 401,
                contentType: 'text/html; charset=utf-8',
                body: challengeHtml(challenge === 'once'),
              });
            } else {
              await route.fulfill({
                status: options.status ?? 200,
                contentType: 'text/html; charset=utf-8',
                body:
                  options.status === undefined
                    ? productHtml(
                        options.renderedCity ?? productMatch[1],
                        options.isAvailable ?? true,
                      )
                    : '',
              });
            }

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

void test('reads the product in the selected city even after hydration removes INITIAL_STATE', async (): Promise<void> => {
  const result = await createReader().read(
    reference.inCity('irkutsk', 'Иркутск'),
    proxy,
    new AbortController().signal,
  );

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.title, 'Йодомарин 200 50 шт. таблетки');
  assert.deepEqual(result.snapshot.prices, [{ amountMinor: 14_100, currency: 'RUB' }]);
  assert.equal(result.snapshot.availability, 'in_stock');
  assert.equal(
    result.snapshot.imageUrl,
    'https://images.apteka.ru/original_3c1bcf4a-d96f-49d9-9831-d2cf19238f5f.webp',
  );
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

void test('reads the product after a Qrator challenge reloads the page', async (): Promise<void> => {
  const result = await createReader({ challenge: 'once' }).read(
    reference.inCity('irkutsk', 'Иркутск'),
    proxy,
    new AbortController().signal,
  );

  assert.equal(result.status, 'success');
  assert.equal(browser.contexts().length, 0);
});

void test('reports a persistent Qrator check as challenge_required', async (): Promise<void> => {
  const result = await createReader({ challenge: 'always' }).read(
    reference,
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(result, { status: 'challenge_required' });
  assert.equal(browser.contexts().length, 0);
});

void test('reports an HTTP error instead of the product page', async (): Promise<void> => {
  const result = await createReader({ status: 500 }).read(
    reference,
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(result, { status: 'http_error', httpStatus: 500 });
});

void test('rejects a non-Russian exit before loading the product', async (): Promise<void> => {
  const result = await createReader({ country: 'US' }).read(
    reference,
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(result, { status: 'proxy_rejected', stage: 'exit' });
});

void test('discards the price when the rendered city does not match the requested city', async (): Promise<void> => {
  const result = await createReader({ renderedCity: 'moskva' }).read(
    reference.inCity('irkutsk', 'Иркутск'),
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(result, { status: 'parse_error' });
});

void test('rejects an unsafe city slug without navigating', async (): Promise<void> => {
  const result = await createReader().read(
    reference.inCity('../evil', 'Evil'),
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(result, { status: 'parse_error' });
  assert.equal(browser.contexts().length, 0);
});

void test('reads the product through a direct connection when proxy is null', async (): Promise<void> => {
  let contextOptions: BrowserContextOptions | undefined;
  const reader = createReader({}, (options): void => {
    contextOptions = options;
  });

  const result = await reader.read(reference, null, new AbortController().signal);

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.exitIp, null);
  assert.equal(contextOptions?.proxy, undefined);
  assert.equal(browser.contexts().length, 0);
});
