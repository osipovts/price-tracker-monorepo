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
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { WildberriesBrowserCitySourceAdapter } from './wildberries-browser-city-source.adapter.js';
import { WildberriesPickupCitiesParser } from './wildberries-pickup-cities.parser.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

interface SiteInterface {
  /** Whether the site shows its pages; otherwise it keeps showing its check. */
  opens?: boolean;
  /** The answer of the file of the pickup points. */
  file?: { status: number; body: unknown };
}

const points = [
  {
    country: 'ru',
    items: [
      {
        id: 1,
        address: 'Россия, Иркутская обл., г. Иркутск, ул. Ленина, 1',
        dest: -5827226,
        rate: 5,
      },
      { id: 2, address: 'Ангарск, Улица Карла Маркса 3', dest: 1259571024 },
      { id: 3, address: 'Барнаул, Улица Попова 4', dest: -3 },
      { id: 4, address: 'село Бахметьево, Центральная Улица 4', dest: -4 },
    ],
  },
  { country: 'by', items: [{ id: 5, address: 'Брест, Улица Советская 1', dest: -5 }] },
];

function createSource(
  site: SiteInterface,
  inspect?: (options: BrowserContextOptions | undefined) => void,
): WildberriesBrowserCitySourceAdapter {
  return new WildberriesBrowserCitySourceAdapter(
    {
      newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
        inspect?.(options);
        const context = await browser.newContext(options);
        await context.route('**/*', async (route: Route): Promise<void> => {
          const url = new URL(route.request().url());
          if (url.origin === 'https://www.wildberries.ru') {
            await route.fulfill({
              contentType: 'text/html; charset=utf-8',
              body:
                site.opens === false
                  ? '<title>Почти готово...</title>'
                  : '<span data-wba-header-name="DLV_Adress">Москва</span>',
            });
          } else if (url.origin === 'https://static-basket-01.wbbasket.ru') {
            const answer = site.file ?? { status: 200, body: points };
            await route.fulfill({
              status: answer.status,
              json: answer.body,
              headers: { 'access-control-allow-origin': '*' },
            });
          } else {
            await route.abort();
          }
        });

        return context;
      },
    },
    new CamoufoxOptionsFactory(),
    new WildberriesPickupCitiesParser(),
    1500,
    3000,
  );
}

const proxy = new ProxyEndpointEntity('socks5://217.71.230.1:1080');
const signal = new AbortController().signal;

void test('reads the pickup points of Russia once, and gives their towns by the first letter', async (): Promise<void> => {
  let given: BrowserContextOptions | undefined;
  const source = createSource({}, (options) => {
    given = options;
  });

  const session = await source.open(proxy, signal);
  const a = await session.read('А', signal);
  const b = await session.read('Б', signal);
  const i = await session.read('И', signal);
  await session.close();

  assert.equal(given?.proxy?.server, 'socks5://217.71.230.1:1080');
  assert.deepEqual(a, [{ id: '1259571024', name: 'Ангарск', region: null, aliases: [] }]);
  assert.deepEqual(b, [{ id: '-3', name: 'Барнаул', region: null, aliases: [] }]);
  assert.deepEqual(i, [{ id: '-5827226', name: 'Иркутск', region: 'Иркутская обл.', aliases: [] }]);
  assert.equal(browser.contexts().length, 0);
});

void test('does not open when the site keeps showing its check, and leaves no browser context behind', async (): Promise<void> => {
  await assert.rejects(createSource({ opens: false }).open(proxy, signal));
  assert.equal(browser.contexts().length, 0);
});

void test('rejects a file that is not a success, or not the list of the points', async (): Promise<void> => {
  await assert.rejects(createSource({ file: { status: 404, body: {} } }).open(proxy, signal));
  await assert.rejects(
    createSource({
      file: { status: 200, body: [{ country: 'ru', items: [{ address: 'Иркутск', dest: 'x' }] }] },
    }).open(proxy, signal),
  );
  assert.equal(browser.contexts().length, 0);
});
