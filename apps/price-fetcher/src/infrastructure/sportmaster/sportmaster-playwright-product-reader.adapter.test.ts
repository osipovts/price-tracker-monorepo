import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Camoufox } from 'camoufox-js';
import { CamoufoxOptionsFactory } from 'camoufox-options';
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Route,
} from 'playwright-core';
import { ProductReferenceEntity, SportmasterReferenceParser } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { SportmasterPageParser } from './sportmaster-page.parser.js';
import {
  SportmasterPlaywrightProductReaderAdapter,
  type SportmasterReaderParsersInterface,
} from './sportmaster-playwright-product-reader.adapter.js';
import { SportmasterProductParser } from './sportmaster-product.parser.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const reference = new ProductReferenceEntity(
  'sportmaster',
  '33427090299',
  'https://www.sportmaster.ru/product/33427090299/',
);
const proxy = new ProxyEndpointEntity('socks5://217.71.230.103:1080');
const parsers: SportmasterReaderParsersInterface = {
  geoIp: new GeoIpPageParser(),
  pages: new SportmasterPageParser(),
  products: new SportmasterProductParser(new SportmasterReferenceParser()),
};

function productPage(isAvailable: boolean, cityId: string): string {
  const structured = [
    {
      '@type': 'Product',
      name: 'Беспроводные наушники Lenovo LP80 Pro Live Pods TWS белые',
      image: ['https://cdn.sportmaster.ru/upload/mdm/media_content/139852800299.jpg'],
      offers: {
        '@type': 'Offer',
        price: 2287,
        priceCurrency: 'RUB',
        availability: isAvailable ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
    },
  ];

  return `<script>dataLayer = [{"cityId":"${cityId}"}];</script><script type="application/ld+json">${JSON.stringify(structured)}</script>`;
}

function challengePage(reload: boolean): string {
  return `<script src="/__qrator/qauth.js"></script><div id="captcha-img"></div>${
    reload ? '<script>setTimeout(() => location.reload(), 10)</script>' : ''
  }`;
}

function createReader(
  options: {
    country?: string;
    status?: number;
    isAvailable?: boolean;
    ignoreCityChange?: boolean;
    challenge?: 'once' | 'always' | 'never';
  } = {},
): SportmasterPlaywrightProductReaderAdapter {
  let challenged = false;
  let cityId = '1720920299';

  return new SportmasterPlaywrightProductReaderAdapter(
    {
      newContext: async (contextOptions?: BrowserContextOptions): Promise<BrowserContext> => {
        const context = await browser.newContext(contextOptions);

        await context.route('**/*', async (route: Route): Promise<void> => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.hostname === 'ipinfo.io') {
            await route.fulfill({
              json: { ip: '217.71.230.103', country: options.country ?? 'RU' },
            });
          } else if (url.pathname === '/web-api/v1/cities') {
            assert.equal(url.searchParams.get('text'), 'Казань');
            await route.fulfill({
              json: {
                cities: [
                  {
                    cityId: '28300299',
                    cityName: 'Казань',
                    geoPoint: { lat: 55.79494, lon: 49.105045 },
                  },
                ],
              },
            });
          } else if (url.pathname === '/web-api/v1/profiles/current/location') {
            assert.equal(request.method(), 'PUT');
            assert.deepEqual(request.postDataJSON(), {
              geoPoint: { lat: 55.79494, lon: 49.105045 },
              locationLevel: 'OTHER',
              locationName: 'Казань',
              name: 'Казань',
            });
            if (options.ignoreCityChange !== true) cityId = '28300299';
            await route.fulfill({ status: 200 });
          } else if (url.href === reference.url) {
            const challenge = options.challenge ?? 'once';
            if (challenge === 'always' || (challenge === 'once' && !challenged)) {
              challenged = true;
              await route.fulfill({
                status: 401,
                contentType: 'text/html; charset=utf-8',
                body: challengePage(challenge === 'once'),
              });
            } else {
              await route.fulfill({
                status: options.status ?? 200,
                contentType: 'text/html; charset=utf-8',
                body:
                  options.status === undefined
                    ? productPage(options.isAvailable ?? true, cityId)
                    : '',
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
    1_000,
  );
}

void test('reads the product after the Qrator check reloads the page', async (): Promise<void> => {
  const result = await createReader().read(reference, proxy, new AbortController().signal);

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.title, 'Беспроводные наушники Lenovo LP80 Pro Live Pods TWS белые');
  assert.deepEqual(result.snapshot.prices, [{ amountMinor: 228_700, currency: 'RUB' }]);
  assert.equal(result.snapshot.availability, 'in_stock');
  assert.equal(result.exitIp, '217.71.230.103');
  assert.equal(browser.contexts().length, 0);
});

void test('keeps the price of a product out of stock', async (): Promise<void> => {
  const result = await createReader({ isAvailable: false }).read(
    reference,
    proxy,
    new AbortController().signal,
  );

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.availability, 'out_of_stock');
  assert.deepEqual(result.snapshot.prices, [{ amountMinor: 228_700, currency: 'RUB' }]);
});

void test('reports a Qrator check that does not let the product through', async (): Promise<void> => {
  const result = await createReader({ challenge: 'always' }).read(
    reference,
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(result, { status: 'challenge_required' });
  assert.equal(browser.contexts().length, 0);
});

void test('reports an HTTP error instead of the product page', async (): Promise<void> => {
  const reader = createReader({ challenge: 'never', status: 500 });

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'http_error',
    httpStatus: 500,
  });
});

void test('rejects a non-Russian exit before loading the product', async (): Promise<void> => {
  const reader = createReader({ country: 'US' });

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'proxy_rejected',
    stage: 'exit',
  });
});

void test('reads the product only after confirming the selected city on the reloaded page', async (): Promise<void> => {
  const result = await createReader({ challenge: 'never' }).read(
    reference.inCity('28300299', 'Казань'),
    proxy,
    new AbortController().signal,
  );

  assert.equal(result.status, 'success');
});

void test('discards the price when the site keeps its previous city', async (): Promise<void> => {
  const result = await createReader({ challenge: 'never', ignoreCityChange: true }).read(
    reference.inCity('28300299', 'Казань'),
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(result, { status: 'parse_error' });
});
