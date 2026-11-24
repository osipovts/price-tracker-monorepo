import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Camoufox } from 'camoufox-js';
import { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, BrowserContextOptions, Route } from 'playwright-core';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { CifrusBrowserCitySourceAdapter } from './cifrus-browser-city-source.adapter.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const proxy = new ProxyEndpointEntity('socks5://217.71.230.1:1080');
const signal = new AbortController().signal;

const pageOneHtml = `
<ul class="city-list">
  <li class="city-item city-item-current" data-id="74507">
    <div class="city-name">Москва и МО <span class="city-badge both">Самовывоз + Доставка</span><span class="city-current-mark"><span>выбран</span></span></div>
  </li>
  <li class="city-item" data-id="103667">
    <div class="city-name">Санкт-Петербург <span class="city-badge both">Самовывоз + Доставка</span></div>
  </li>
</ul>
<div class="city-load-more" data-page="2">Показать ещё</div>`;

const pageTwoHtml = `
<ul class="city-list">
  <li class="city-item" data-id="103667">
    <div class="city-name">Санкт-Петербург <span class="city-badge both">Самовывоз + Доставка</span></div>
  </li>
  <li class="city-item" data-id="41910">
    <div class="city-name">Иркутск <span class="city-badge delivery">Доставка</span></div>
  </li>
</ul>`;

interface SiteInterface {
  homeStatus?: number;
  homeChallenge?: boolean;
  ajaxStatus?: number;
  ajaxChallenge?: boolean;
  emptyCities?: boolean;
}

function createSource(
  site: SiteInterface = {},
  inspect?: (options: BrowserContextOptions | undefined) => void,
): {
  source: CifrusBrowserCitySourceAdapter;
  pagesRequested: string[];
} {
  const pagesRequested: string[] = [];
  const source = new CifrusBrowserCitySourceAdapter(
    {
      newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
        inspect?.(options);
        const context = await browser.newContext(options);
        await context.route('**/*', async (route: Route): Promise<void> => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin === 'https://www.cifrus.ru' && url.pathname === '/') {
            await route.fulfill({
              status: site.homeStatus ?? 200,
              contentType: 'text/html; charset=utf-8',
              body:
                site.homeChallenge === true
                  ? '<div class="g-recaptcha"></div><script>fetch("/unlock.php")</script>'
                  : '<div id="city_trigger_header"></div>',
            });

            return;
          }

          if (url.origin === 'https://www.cifrus.ru' && url.pathname === '/ajax/city_ajax.php') {
            const params = new URLSearchParams(request.postData() ?? '');
            const page = params.get('page') ?? '1';
            pagesRequested.push(page);
            if (site.ajaxChallenge === true) {
              await route.fulfill({
                status: 403,
                contentType: 'text/html; charset=utf-8',
                body: '<div class="g-recaptcha"></div>',
              });

              return;
            }
            if (site.ajaxStatus !== undefined && site.ajaxStatus !== 200) {
              await route.fulfill({ status: site.ajaxStatus, body: '' });

              return;
            }

            const body =
              site.emptyCities === true
                ? '<div class="city-no-result">Пусто</div>'
                : page === '2'
                  ? pageTwoHtml
                  : pageOneHtml;
            await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });

            return;
          }

          await route.abort();
        });

        return context;
      },
    },
    new CamoufoxOptionsFactory(),
    10_000,
    0,
  );

  return { source, pagesRequested };
}

void test('paginates city_ajax.php, extracts clean names with null region, and deduplicates', async (): Promise<void> => {
  const { source, pagesRequested } = createSource();

  const session = await source.open(proxy, signal);
  const cities = await session.read('all', signal);
  await session.close();

  assert.deepEqual(pagesRequested, ['1', '2']);
  assert.deepEqual(cities, [
    { id: '74507', name: 'Москва и МО', region: null },
    { id: '103667', name: 'Санкт-Петербург', region: null },
    { id: '41910', name: 'Иркутск', region: null },
  ]);
  assert.equal(browser.contexts().length, 0);
});

void test('connects through the given proxy and cleans up on homepage captcha', async (): Promise<void> => {
  let given: BrowserContextOptions | undefined;
  const { source } = createSource({ homeStatus: 403, homeChallenge: true }, (options): void => {
    given = options;
  });

  await assert.rejects(source.open(proxy, signal), /captcha/);
  assert.equal(given?.proxy?.server, 'socks5://217.71.230.1:1080');
  assert.equal(browser.contexts().length, 0);
});

void test('connects directly when proxy is null', async (): Promise<void> => {
  let given: BrowserContextOptions | undefined;
  const { source } = createSource({}, (options): void => {
    given = options;
  });

  const session = await source.open(null, signal);
  await session.close();

  assert.equal(given?.proxy, undefined);
  assert.equal(browser.contexts().length, 0);
});

void test('rejects non-200, captcha, or empty city_ajax responses', async (): Promise<void> => {
  for (const site of [{ ajaxStatus: 500 }, { ajaxChallenge: true }, { emptyCities: true }]) {
    const { source } = createSource(site);
    const session = await source.open(proxy, signal);

    await assert.rejects(session.read('all', signal));
    await session.close();
    assert.equal(browser.contexts().length, 0);
  }
});
