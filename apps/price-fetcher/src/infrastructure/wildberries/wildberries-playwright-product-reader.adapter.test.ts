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
import { ProductReferenceEntity, WildberriesReferenceParser } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { WildberriesChallengeParser } from './wildberries-challenge.parser.js';
import { WildberriesPageParser } from './wildberries-page.parser.js';
import {
  WildberriesPlaywrightProductReaderAdapter,
  type WildberriesReaderParsersInterface,
} from './wildberries-playwright-product-reader.adapter.js';
import { WildberriesProductParser } from './wildberries-product.parser.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const reference = new ProductReferenceEntity(
  'wildberries',
  '169684889',
  'https://www.wildberries.ru/catalog/169684889/detail.aspx',
);
const proxy = new ProxyEndpointEntity('socks5://217.71.230.103:1080');
const parsers: WildberriesReaderParsersInterface = {
  geoIp: new GeoIpPageParser(),
  pages: new WildberriesPageParser(),
  challenges: new WildberriesChallengeParser(),
  products: new WildberriesProductParser(new WildberriesReferenceParser()),
};
const cardPath = '/__internal/u-card/cards/v4/detail?appType=1&curr=rub&dest=-1257786';

/** A product page that asks the card service for the products it shows, as the site does. */
function pageAsking(...numbers: string[]): string {
  return `<title>Кроссовки</title><meta property="og:image" content="https://basket-12.wbbasket.ru/vol1696/part169684/169684889/images/big/1.webp"><script>
    for (const nm of ${JSON.stringify(numbers)}) void fetch('${cardPath}&nm=' + nm);
  </script>`;
}

function cardOf(id: number, amountMinor: number): object {
  return {
    products: [
      {
        id,
        name: `Товар ${String(id)}`,
        sizes: [{ price: { basic: amountMinor * 2, product: amountMinor }, stocks: [{ qty: 1 }] }],
        totalQuantity: 1,
      },
    ],
  };
}

function createReader(
  html: string,
  country = 'RU',
  status = 200,
): WildberriesPlaywrightProductReaderAdapter {
  return new WildberriesPlaywrightProductReaderAdapter(
    {
      newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
        const context = await browser.newContext(options);

        await context.route('**/*', async (route: Route): Promise<void> => {
          const url = new URL(route.request().url());
          if (url.hostname === 'ipinfo.io') {
            await route.fulfill({ json: { ip: '217.71.230.103', country } });
          } else if (url.href === reference.url) {
            await route.fulfill({ status, contentType: 'text/html; charset=utf-8', body: html });
          } else if (url.pathname.endsWith('/cards/v4/detail')) {
            const id = Number(url.searchParams.get('nm')?.split(';')[0]);
            await route.fulfill({ json: cardOf(id, id === 169684889 ? 329900 : 100) });
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

void test('reads the product from the answer of the card service to the page, not from those about other products', async (): Promise<void> => {
  const reader = createReader(pageAsking('1;2', '169684889', '3'));

  const result = await reader.read(reference, proxy, new AbortController().signal);

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.title, 'Товар 169684889');
  assert.deepEqual(result.snapshot.prices, [{ amountMinor: 329900, currency: 'RUB' }]);
  assert.equal(
    result.snapshot.imageUrl,
    'https://basket-12.wbbasket.ru/vol1696/part169684/169684889/images/c246x328/1.webp',
  );
  assert.equal(result.exitIp, '217.71.230.103');
  assert.equal(browser.contexts().length, 0);
});

void test('a page whose card service did not answer about the product is a parse error', async (): Promise<void> => {
  const reader = createReader(pageAsking('1'));

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'parse_error',
  });
  assert.equal(browser.contexts().length, 0);
});

void test('reports the antibot check of the site', async (): Promise<void> => {
  const reader = createReader('<title>Почти готово...</title><p>Проверяем браузер</p>', 'RU', 498);

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'challenge_required',
  });
});

void test('reports an HTTP error instead of the product page', async (): Promise<void> => {
  const reader = createReader('<title>Not found</title>', 'RU', 404);

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'http_error',
    httpStatus: 404,
  });
});

void test('rejects a non-Russian exit before loading the product', async (): Promise<void> => {
  const reader = createReader(pageAsking('169684889'), 'US');

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'proxy_rejected',
  });
});
