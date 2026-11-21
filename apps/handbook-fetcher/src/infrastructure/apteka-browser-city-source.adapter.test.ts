import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Camoufox } from 'camoufox-js';
import { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, BrowserContextOptions, Route } from 'playwright-core';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import { AptekaBrowserCitySourceAdapter } from './apteka-browser-city-source.adapter.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const proxy = new ProxyEndpointEntity('socks5://217.71.230.1:1080');
const signal = new AbortController().signal;

const corsHeaders = {
  'access-control-allow-origin': 'https://apteka.ru',
  'access-control-allow-credentials': 'true',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'user-session-id, device-id',
};

interface SiteInterface {
  opens?: boolean;
  urlsStatus?: number;
  detailStatuses?: Readonly<Record<string, number>>;
}

function createSource(
  site: SiteInterface = {},
  inspect?: (options: BrowserContextOptions | undefined) => void,
): {
  source: AptekaBrowserCitySourceAdapter;
  requests: Array<{ path: string; sessionId: string | null; deviceId: string | null }>;
} {
  const requests: Array<{ path: string; sessionId: string | null; deviceId: string | null }> = [];
  const source = new AptekaBrowserCitySourceAdapter(
    {
      newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
        inspect?.(options);
        const context = await browser.newContext(options);
        await context.route('**/*', async (route: Route): Promise<void> => {
          const request = route.request();
          const url = new URL(request.url());
          if (request.method() === 'OPTIONS' && url.origin === 'https://api.apteka.ru') {
            await route.fulfill({ status: 204, headers: corsHeaders });

            return;
          }

          if (url.origin === 'https://apteka.ru' && url.pathname === '/') {
            await route.fulfill({
              contentType: 'text/html; charset=utf-8',
              body:
                site.opens === false
                  ? '<title>Проверка</title>'
                  : '<script>document.cookie="user-session-id.v5=sid-1; path=/";document.cookie="device-id.v4=did-1; path=/";</script>',
            });

            return;
          }

          if (url.origin === 'https://api.apteka.ru' && url.pathname === '/City/CitiesUrls') {
            requests.push({
              path: url.pathname,
              sessionId: await request.headerValue('user-session-id'),
              deviceId: await request.headerValue('device-id'),
            });
            await route.fulfill({
              status: site.urlsStatus ?? 200,
              headers: corsHeaders,
              json: [
                { id: '1', url: 'moskva', name: 'Москве' },
                { id: '2', url: 'irkutsk', name: 'Иркутске' },
                { id: '3', url: 'izhevsk', name: 'Ижевске' },
                { id: '4', url: 'iskitim', name: 'Искитиме' },
              ],
            });

            return;
          }

          if (url.origin === 'https://api.apteka.ru' && url.pathname === '/City') {
            const slug = url.searchParams.get('url') ?? '';
            requests.push({
              path: `${url.pathname}${url.search}`,
              sessionId: await request.headerValue('user-session-id'),
              deviceId: await request.headerValue('device-id'),
            });
            const status = site.detailStatuses?.[slug] ?? 200;
            if (status !== 200) {
              await route.fulfill({ status, headers: corsHeaders, body: '' });

              return;
            }

            const details: Record<string, unknown> = {
              moskva: { url: 'moskva', name: 'Москва', state: 'Москва' },
              irkutsk: { url: 'irkutsk', name: 'Иркутск', state: 'Иркутская область' },
              izhevsk: { url: 'izhevsk', name: 'Ижевск', state: 'Удмуртская Республика' },
            };
            await route.fulfill({
              headers: corsHeaders,
              json: details[slug] ?? { url: slug, name: slug, state: null },
            });

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

  return { source, requests };
}

void test('fetches city URLs once per session, verifies headers, maps regions and skips 404 details', async (): Promise<void> => {
  const { source, requests } = createSource({ detailStatuses: { iskitim: 404 } });

  const session = await source.open(proxy, signal);
  const moscowCities = await session.read('М', signal);
  const iCities = await session.read('И', signal);
  await session.close();

  assert.deepEqual(moscowCities, [{ id: 'moskva', name: 'Москва', region: null }]);
  assert.deepEqual(iCities, [
    { id: 'irkutsk', name: 'Иркутск', region: 'Иркутская область' },
    { id: 'izhevsk', name: 'Ижевск', region: 'Удмуртская Республика' },
  ]);
  assert.equal(
    requests.filter((request): boolean => request.path === '/City/CitiesUrls').length,
    1,
  );
  assert.ok(
    requests.every(
      (request): boolean => request.sessionId === 'sid-1' && request.deviceId === 'did-1',
    ),
  );
  assert.equal(browser.contexts().length, 0);
});

void test('connects through the given proxy and cleans up on failure', async (): Promise<void> => {
  let given: BrowserContextOptions | undefined;
  const { source } = createSource({ opens: false }, (options): void => {
    given = options;
  });

  await assert.rejects(source.open(proxy, signal));
  assert.equal(given?.proxy?.server, 'socks5://217.71.230.1:1080');
  assert.equal(browser.contexts().length, 0);
});

void test('connects directly when proxy is null', async (): Promise<void> => {
  let given: BrowserContextOptions | undefined;
  const { source } = createSource({ opens: false }, (options): void => {
    given = options;
  });

  await assert.rejects(source.open(null, signal));
  assert.equal(given?.proxy, undefined);
  assert.equal(browser.contexts().length, 0);
});

void test('rejects unsuccessful API responses', async (): Promise<void> => {
  const { source } = createSource({ urlsStatus: 432 });
  const session = await source.open(proxy, signal);

  await assert.rejects(session.read('М', signal));
  await session.close();
  assert.equal(browser.contexts().length, 0);
});
