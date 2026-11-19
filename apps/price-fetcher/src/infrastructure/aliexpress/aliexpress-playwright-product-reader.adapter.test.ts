import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Camoufox } from 'camoufox-js';
import { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, BrowserContextOptions, Route } from 'playwright-core';
import { AliexpressReferenceParser, ProductReferenceEntity } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { AliexpressPageParser } from './aliexpress-page.parser.js';
import {
  AliexpressPlaywrightProductReaderAdapter,
  type AliexpressReaderParsersInterface,
} from './aliexpress-playwright-product-reader.adapter.js';
import { AliexpressProductParser } from './aliexpress-product.parser.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const reference = new ProductReferenceEntity(
  'aliexpress',
  '1005012815784218',
  'https://aliexpress.ru/item/1005012815784218.html',
);
const proxy = new ProxyEndpointEntity('socks5://217.71.230.103:1080');
const parsers: AliexpressReaderParsersInterface = {
  geoIp: new GeoIpPageParser(),
  pages: new AliexpressPageParser(),
  products: new AliexpressProductParser(new AliexpressReferenceParser()),
};

function productPage(cityId: string): string {
  const aerData = {
    widgets: [
      {
        widgetId: 'bx/ShipToHeaderItem/0.36.0',
        props: {
          userGeoInfo: {
            country: { code: 'RU', name: 'Россия' },
            city: { code: cityId, name: 'Город' },
          },
        },
      },
    ],
  };

  return `<script id="__AER_DATA__" type="application/json">${JSON.stringify(aerData)}</script><script>fetch('/aer-jsonapi/v1/bx/pdp/web/productData?productId=1005012815784218&sourceId=0&sku_id=0');</script>`;
}

function productDataPayload(isAvailable: boolean, cityId: string): unknown {
  return {
    data: {
      id: '1005012815784218',
      name: 'Акриловый брелок Nightcrawler Курт Вагнер чиби',
      gallery: [
        {
          imageUrl:
            'https://ae-pic-a1.aliexpress-media.com/kf/S47ae477f66004551a22e01cad75610e0K.png',
        },
      ],
      activeSkuId: '12000059397901048',
      itemStatus: isAvailable ? 0 : 1,
      quantity: { totalCount: isAvailable ? '3' : '0' },
      skuInfo: {
        priceList: [
          {
            skuId: '12000059397901048',
            availQuantity: isAvailable ? 3 : 0,
            activityAmount: { value: 399, currency: 'RUB', cents: '39900' },
          },
        ],
      },
      delivery: { to: { city: cityId } },
    },
  };
}

function createReader(
  options: {
    country?: string;
    status?: number;
    isAvailable?: boolean;
    ignoreCityChange?: boolean;
    challenge?: 'page' | 'api' | 'none';
  } = {},
  seenCookies: string[] = [],
  inspectOptions?: (options: BrowserContextOptions | undefined) => void,
): AliexpressPlaywrightProductReaderAdapter {
  return new AliexpressPlaywrightProductReaderAdapter(
    {
      newContext: async (contextOptions?: BrowserContextOptions): Promise<BrowserContext> => {
        inspectOptions?.(contextOptions);
        const context = await browser.newContext(contextOptions);

        await context.route('**/*', async (route: Route): Promise<void> => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.hostname === 'ipinfo.io') {
            await route.fulfill({
              json: { ip: '217.71.230.103', country: options.country ?? 'RU' },
            });
          } else if (url.href === reference.url) {
            const cookie = await request.headerValue('cookie');
            if (cookie !== null) seenCookies.push(cookie);
            const match = /city=(\d+)/.exec(cookie ?? '');
            const cityId =
              options.ignoreCityChange === true
                ? '917477679070000000'
                : (match?.[1] ?? '917477679070000000');
            if (options.challenge === 'page') {
              await route.fulfill({
                status: 200,
                contentType: 'text/html; charset=utf-8',
                body: '<div id="nocaptcha"></div>',
              });
            } else {
              await route.fulfill({
                status: options.status ?? 200,
                contentType: 'text/html; charset=utf-8',
                body: options.status === undefined ? productPage(cityId) : '',
              });
            }
          } else if (url.pathname === '/aer-jsonapi/v1/bx/pdp/web/productData') {
            if (options.challenge === 'api') {
              await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: '{"rgv587_flag":"sm","data":{"url":"https://aliexpress.ru/_____tmd_____/punish"}}',
              });
            } else {
              const cookie = await request.headerValue('cookie');
              const match = /city=(\d+)/.exec(cookie ?? '');
              const cityId =
                options.ignoreCityChange === true
                  ? '917477679070000000'
                  : (match?.[1] ?? '917477679070000000');
              await route.fulfill({
                json: productDataPayload(options.isAvailable ?? true, cityId),
              });
            }
          } else {
            await route.abort();
          }
        });

        return context;
      },
    },
    new CamoufoxOptionsFactory(),
    parsers,
    10_000,
  );
}

void test('reads the product in the selected city via aep_usuc_f cookie', async (): Promise<void> => {
  const seenCookies: string[] = [];
  const result = await createReader({}, seenCookies).read(
    reference.inCity('917473757371000000', 'Иркутск'),
    proxy,
    new AbortController().signal,
  );

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.title, 'Акриловый брелок Nightcrawler Курт Вагнер чиби');
  assert.deepEqual(result.snapshot.prices, [{ amountMinor: 39_900, currency: 'RUB' }]);
  assert.equal(result.snapshot.availability, 'in_stock');
  assert.equal(result.exitIp, '217.71.230.103');
  assert.ok(
    seenCookies.some(
      (cookie): boolean =>
        cookie.includes('province=917473750000000000') &&
        cookie.includes('city=917473757371000000'),
    ),
  );
  assert.equal(browser.contexts().length, 0);
});

void test('falls back to Moscow when no city is given and keeps price when out of stock', async (): Promise<void> => {
  const seenCookies: string[] = [];
  const result = await createReader({ isAvailable: false }, seenCookies).read(
    reference,
    proxy,
    new AbortController().signal,
  );

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.availability, 'out_of_stock');
  assert.deepEqual(result.snapshot.prices, [{ amountMinor: 39_900, currency: 'RUB' }]);
  assert.ok(seenCookies.some((cookie): boolean => cookie.includes('city=917477679070000000')));
});

void test('reports antibot challenge pages and punish productData responses as challenge_required', async (): Promise<void> => {
  const pageChallenge = await createReader({ challenge: 'page' }).read(
    reference,
    proxy,
    new AbortController().signal,
  );
  assert.deepEqual(pageChallenge, { status: 'challenge_required' });

  const apiChallenge = await createReader({ challenge: 'api' }).read(
    reference,
    proxy,
    new AbortController().signal,
  );
  assert.deepEqual(apiChallenge, { status: 'challenge_required' });
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

void test('discards the price when the site keeps its previous city', async (): Promise<void> => {
  const result = await createReader({ ignoreCityChange: true }).read(
    reference.inCity('917473757371000000', 'Иркутск'),
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(result, { status: 'parse_error' });
});

void test('reads the product through a direct connection when proxy is null', async (): Promise<void> => {
  let contextOptions: BrowserContextOptions | undefined;
  const reader = createReader({}, [], (options) => {
    contextOptions = options;
  });

  const result = await reader.read(reference, null, new AbortController().signal);

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.exitIp, null);
  assert.equal(contextOptions?.proxy, undefined);
  assert.equal(browser.contexts().length, 0);
});
