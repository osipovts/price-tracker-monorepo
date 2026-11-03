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
import { CitilinkReferenceParser, ProductReferenceEntity } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { CitilinkPageParser } from './citilink-page.parser.js';
import {
  CitilinkPlaywrightProductReaderAdapter,
  type CitilinkReaderParsersInterface,
} from './citilink-playwright-product-reader.adapter.js';
import { CitilinkProductParser } from './citilink-product.parser.js';
import { CitilinkStateParser } from './citilink-state.parser.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const reference = new ProductReferenceEntity(
  'citilink',
  '2194059',
  'https://www.citilink.ru/product/2194059/',
);
const proxy = new ProxyEndpointEntity('socks5://217.71.230.103:1080');
const states = new CitilinkStateParser();
const parsers: CitilinkReaderParsersInterface = {
  geoIp: new GeoIpPageParser(),
  pages: new CitilinkPageParser(),
  states,
  products: new CitilinkProductParser(new CitilinkReferenceParser(), states),
};

/**
 * The card as the server renders it for a city: the club price in Irkutsk is lower than in Moscow. A product out
 * of stock has zeros for its prices.
 */
function pageIn(cityId: string, isAvailable: boolean): string {
  const club = cityId === 'msk_cl' ? '237990' : '237900';
  const initialState = {
    system: { metadata: { 'x-citilink-city-id': cityId } },
    productPage: {
      productHeader: {
        payload: {
          productBase: {
            id: '2194059',
            name: 'Ноутбук ASUS Zenbook A16',
            isAvailable,
            price: isAvailable
              ? { current: '239990', club, clubPriceViewType: 'PRICE_IN_RUB' }
              : { current: '0', club: '0', clubPriceViewType: 'INVALID' },
          },
        },
      },
    },
  };

  return `<title>Ноутбук</title><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { initialState } })}</script>`;
}

/** The server renders the page for the city of the cookie; `fixedCityId` is a server that ignores it. */
function createReader(
  options: { country?: string; status?: number; fixedCityId?: string; isAvailable?: boolean } = {},
): CitilinkPlaywrightProductReaderAdapter {
  return new CitilinkPlaywrightProductReaderAdapter(
    {
      newContext: async (contextOptions?: BrowserContextOptions): Promise<BrowserContext> => {
        const context = await browser.newContext(contextOptions);

        await context.route('**/*', async (route: Route): Promise<void> => {
          const request = route.request();
          const url = new URL(request.url());
          const space = /(?:^|;\s*)_space=([^;]*)/.exec(
            (await request.allHeaders())['cookie'] ?? '',
          )?.[1];
          if (url.hostname === 'ipinfo.io') {
            await route.fulfill({
              json: { ip: '217.71.230.103', country: options.country ?? 'RU' },
            });
          } else if (url.href === reference.url) {
            await route.fulfill({
              status: options.status ?? 200,
              contentType: 'text/html; charset=utf-8',
              body: pageIn(
                options.fixedCityId ??
                  (space === undefined ? 'krasn_cl:cd0008680' : decodeURIComponent(space)),
                options.isAvailable ?? true,
              ),
            });
          } else {
            await route.abort();
          }
        });

        return context;
      },
    },
    new CamoufoxOptionsFactory(),
    parsers,
    3_000,
  );
}

void test('reads the club price of the product in Moscow when no city is asked for', async (): Promise<void> => {
  const result = await createReader().read(reference, proxy, new AbortController().signal);

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.title, 'Ноутбук ASUS Zenbook A16');
  assert.deepEqual(result.snapshot.prices, [
    { amountMinor: 23_799_000, currency: 'RUB' },
    { amountMinor: 23_999_000, currency: 'RUB' },
  ]);
  assert.equal(result.exitIp, '217.71.230.103');
  assert.equal(browser.contexts().length, 0);
});

void test('reads the price in the city asked for', async (): Promise<void> => {
  const result = await createReader().read(
    reference.inCity('krasn_cl:5x0050623'),
    proxy,
    new AbortController().signal,
  );

  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.prices[0]?.amountMinor, 23_790_000);
});

void test('reads a product out of stock without a price', async (): Promise<void> => {
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

void test('a page rendered for another city than the one asked for is a parse error', async (): Promise<void> => {
  const reader = createReader({ fixedCityId: 'krasn_cl:cd0008680' });

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'parse_error',
  });
  assert.equal(browser.contexts().length, 0);
});

void test('reports an HTTP error instead of the product page', async (): Promise<void> => {
  const reader = createReader({ status: 403 });

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'http_error',
    httpStatus: 403,
  });
});

void test('rejects a non-Russian exit before loading the product', async (): Promise<void> => {
  const reader = createReader({ country: 'US' });

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'proxy_rejected',
  });
});
