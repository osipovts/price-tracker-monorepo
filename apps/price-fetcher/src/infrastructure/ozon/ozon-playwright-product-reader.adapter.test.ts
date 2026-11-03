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
import { OzonReferenceParser, ProductReferenceEntity } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { OzonChallengeParser } from './ozon-challenge.parser.js';
import { OzonPageParser } from './ozon-page.parser.js';
import { OzonPickupPointParser } from './ozon-pickup-point.parser.js';
import {
  OzonPlaywrightProductReaderAdapter,
  type OzonReaderParsersInterface,
} from './ozon-playwright-product-reader.adapter.js';
import { OzonProductParser } from './ozon-product.parser.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const reference = new ProductReferenceEntity(
  'ozon',
  '4775581891',
  'https://www.ozon.ru/product/4775581891/',
);
const proxy = new ProxyEndpointEntity('socks5://217.71.230.103:1080');
const parsers: OzonReaderParsersInterface = {
  geoIp: new GeoIpPageParser(),
  pages: new OzonPageParser(),
  challenges: new OzonChallengeParser(),
  products: new OzonProductParser(new OzonReferenceParser()),
  pickupPoints: new OzonPickupPointParser(),
};

/** The pages of the delivery modal the reader asked for, by the address of each in the API. */
let deliveryAsked: string[] = [];
beforeEach((): void => {
  deliveryAsked = [];
});

const moscowPoints = '{"layout":[{"link":"/modal/commonDelivery?pid=5&pp=1261805&tab=pp"}]}';

/** Answers the API of the delivery modal: the pickup points near a place, and the choice of one. */
async function answerDelivery(route: Route, points: string): Promise<boolean> {
  const url = new URL(route.request().url());
  if (url.pathname !== '/api/entrypoint-api.bx/page/json/v2') return false;

  const page = url.searchParams.get('url') ?? '';
  deliveryAsked.push(page);
  await route.fulfill({
    contentType: 'application/json',
    body: page.includes('pid=3') ? points : '{}',
  });

  return true;
}

function createReader(
  html: string,
  country = 'RU',
  status = 200,
  inspectOptions?: (options: BrowserContextOptions | undefined) => void,
  points = moscowPoints,
): OzonPlaywrightProductReaderAdapter {
  return new OzonPlaywrightProductReaderAdapter(
    {
      newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
        inspectOptions?.(options);
        const context = await browser.newContext(options);

        await context.route('**/*', async (route: Route): Promise<void> => {
          if (await answerDelivery(route, points)) return;
          if (route.request().url().startsWith('https://ipinfo.io/')) {
            await route.fulfill({ json: { ip: '217.71.230.103', country } });
          } else if (route.request().url() === reference.url) {
            await route.fulfill({ status, contentType: 'text/html; charset=utf-8', body: html });
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

void test('headless reader waits for rendered prices and excludes hidden and struck amounts', async (): Promise<void> => {
  const reader = createReader(`<h1>Notebook</h1><style>
    .old-price { position: relative; }
    .old-price::after { content: ''; position: absolute; height: 1px; left: 0; top: calc(50% - 1px); width: 100%; background: #777; }
  </style><script>
    setTimeout(() => {
      document.body.insertAdjacentHTML('beforeend', '<div data-widget="webPrice"><span>90\u2009000 ₽</span><span>с Ozon Картой</span><del>120 000 ₽</del><span class="old-price">817\u2009949 ₽</span><span style="display:none">150 000 ₽</span><span>100 000 ₽</span><span>без Ozon Карты</span></div><div data-widget="webAddToCart">В корзину. Осталось 2 штуки</div><div data-widget="webCustoms">Таможенный платёж ~5 000 ₽</div>');
    }, 25);
  </script>`);

  const result = await reader.read(reference, proxy, new AbortController().signal);

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.deepEqual(
    result.snapshot.prices.map((price): number => price.amountMinor),
    [9000000, 10000000],
  );
  assert.equal(result.exitIp, '217.71.230.103');
  assert.equal(browser.contexts().length, 0);
});

void test('headless reader reports an HTTP 403 challenge without parsing fake prices', async (): Promise<void> => {
  const reader = createReader(
    '<title>Antibot Captcha</title><div class="captcha">Подтвердите, что вы человек</div><h1>100 ₽</h1>',
    'RU',
    403,
  );

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'challenge_required',
  });
  assert.equal(browser.contexts().length, 0);
});

void test('reader accepts the final document after a JavaScript challenge redirects from HTTP 403 to 200', async (): Promise<void> => {
  const reader = new OzonPlaywrightProductReaderAdapter(
    {
      newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
        const context = await browser.newContext(options);

        await context.route('**/*', async (route: Route): Promise<void> => {
          if (await answerDelivery(route, moscowPoints)) return;
          if (route.request().url().startsWith('https://ipinfo.io/')) {
            await route.fulfill({ json: { ip: '217.71.230.103', country: 'RU' } });
          } else if (route.request().url() === reference.url) {
            await route.fulfill({
              status: 403,
              contentType: 'text/html',
              body: '<title>Antibot Challenge Page</title><script>setTimeout(() => location.replace("?verified=1"), 25)</script>',
            });
          } else {
            await route.fulfill({
              contentType: 'text/html; charset=utf-8',
              body: '<h1>Notebook</h1><div data-widget="webPrice">100 000 ₽</div>',
            });
          }
        });

        return context;
      },
    },
    new CamoufoxOptionsFactory(),
    parsers,
    10_000,
  );

  const result = await reader.read(reference, proxy, new AbortController().signal);

  assert.equal(result.status, 'success');
  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.prices[0]?.amountMinor, 10000000);
  assert.equal(browser.contexts().length, 0);
});

void test('headless reader rejects a non-Russian exit before loading the product', async (): Promise<void> => {
  const reader = createReader('<h1>Must not be read</h1>', 'US');

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'proxy_rejected',
  });
});

void test('headless reader keeps an unavailable product distinct from a parsing failure', async (): Promise<void> => {
  const reader = createReader(
    '<h1>Notebook</h1><div data-widget="webOutOfStock">Нет в наличии</div>',
  );

  const result = await reader.read(reference, proxy, new AbortController().signal);

  assert.ok('snapshot' in result);
  assert.equal(result.snapshot.availability, 'out_of_stock');
  assert.deepEqual(result.snapshot.prices, []);
});

void test('reader reports a challenge', async (): Promise<void> => {
  const reader = createReader(
    '<title>Antibot Captcha</title><div class="captcha">Подтвердите, что вы человек</div>',
    'RU',
    403,
  );

  assert.deepEqual(await reader.read(reference, proxy, new AbortController().signal), {
    status: 'challenge_required',
  });
});

void test('reads the price at the first pickup point of Moscow for a product without a city', async (): Promise<void> => {
  const reader = createReader('<h1>Notebook</h1><div data-widget="webPrice">100 000 ₽</div>');

  const result = await reader.read(reference, proxy, new AbortController().signal);

  assert.equal(result.status, 'success');
  assert.deepEqual(deliveryAsked, [
    '/modal/commonDelivery?available=t&lat=55.7299&long=37.5907&pid=3&tab=pp',
    '/modal/commonDelivery?pid=7&pp=1261805&tab=pp',
  ]);
});

void test('reads the price at a pickup point of the city of the product', async (): Promise<void> => {
  const reader = createReader('<h1>Notebook</h1><div data-widget="webPrice">100 000 ₽</div>');

  await reader.read(reference.inCity('irkutsk'), proxy, new AbortController().signal);

  assert.equal(
    deliveryAsked[0],
    '/modal/commonDelivery?available=t&lat=52.2753&long=104.2955&pid=3&tab=pp',
  );
});

void test('reads no price where it cannot choose a pickup point of the city', async (): Promise<void> => {
  const html = '<h1>Notebook</h1><div data-widget="webPrice">100 000 ₽</div>';

  assert.deepEqual(
    await createReader(html, 'RU', 200, undefined, '{"layout":[]}').read(
      reference,
      proxy,
      new AbortController().signal,
    ),
    { status: 'parse_error' },
  );
  assert.deepEqual(
    await createReader(html).read(
      reference.inCity('atlantis'),
      proxy,
      new AbortController().signal,
    ),
    { status: 'parse_error' },
  );
  assert.equal(browser.contexts().length, 0);
});
