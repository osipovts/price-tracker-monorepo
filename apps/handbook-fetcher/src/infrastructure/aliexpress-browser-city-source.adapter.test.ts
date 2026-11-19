import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Camoufox } from 'camoufox-js';
import { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, BrowserContextOptions, Route } from 'playwright-core';
import { ProxyEndpointEntity } from 'proxy-endpoint';
import { z } from 'zod';

import { AliexpressBrowserCitySourceAdapter } from './aliexpress-browser-city-source.adapter.js';

const suggestBodySchema = z.object({
  provinceCode: z.string().optional(),
  query: z.string().optional(),
});

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const proxy = new ProxyEndpointEntity('socks5://217.71.230.1:1080');
const signal = new AbortController().signal;

interface SiteInterface {
  opens?: boolean;
  provincesStatus?: number;
  citiesStatus?: number;
  provincesBody?: unknown;
}

function createSource(
  site: SiteInterface = {},
  inspect?: (options: BrowserContextOptions | undefined) => void,
): {
  source: AliexpressBrowserCitySourceAdapter;
  requests: Array<{ path: string; body: unknown }>;
} {
  const requests: Array<{ path: string; body: unknown }> = [];
  const source = new AliexpressBrowserCitySourceAdapter(
    {
      newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
        inspect?.(options);
        const context = await browser.newContext(options);
        await context.route('**/*', async (route: Route): Promise<void> => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin === 'https://aliexpress.ru' && url.pathname === '/') {
            await route.fulfill({
              contentType: 'text/html; charset=utf-8',
              body:
                site.opens === false
                  ? '<title>Проверка</title>'
                  : '<div class="ShipToHeaderItem_ShipToHeaderItem__container__1k3o7">Москва</div>',
            });
          } else if (url.pathname === '/aer-jsonapi/bl/maps/v1/address/get-province-suggests') {
            requests.push({ path: url.pathname, body: request.postDataJSON() });
            await route.fulfill({
              status: site.provincesStatus ?? 200,
              json: site.provincesBody ?? {
                data: {
                  provinces: [
                    { code: '917473750000000000', name: 'Иркутская обл' },
                    { code: '917477670000000000', name: 'Москва г' },
                  ],
                },
              },
            });
          } else if (url.pathname === '/aer-jsonapi/bl/maps/v1/address/get-city-suggests') {
            const body = suggestBodySchema.parse(request.postDataJSON());
            requests.push({ path: url.pathname, body });
            if (site.citiesStatus !== undefined && site.citiesStatus !== 200) {
              await route.fulfill({ status: site.citiesStatus, json: {} });

              return;
            }
            if (body.provinceCode === '917473750000000000') {
              await route.fulfill({
                json: {
                  data: {
                    cities: [
                      {
                        cityCode: '917473757371000000',
                        cityName: 'Иркутск',
                        extendedCityName: 'Иркутская область',
                        localityType: 'город',
                      },
                      {
                        cityCode: '917473756578000000',
                        cityName: 'Ангарск',
                        extendedCityName: 'Иркутская область',
                        localityType: 'город',
                      },
                    ],
                  },
                },
              });
            } else if (body.query === 'И') {
              await route.fulfill({
                json: {
                  data: {
                    cities: [
                      {
                        cityCode: '917473757371000000',
                        cityName: 'Иркутск',
                        extendedCityName: 'Иркутская область',
                        localityType: 'город',
                      },
                      {
                        cityCode: '917473867386000000',
                        cityName: 'Иваново',
                        extendedCityName: 'Ивановская область',
                        localityType: 'город',
                      },
                      {
                        cityCode: '917473759999000000',
                        cityName: 'Ильинка',
                        extendedCityName: 'Иркутская область',
                        localityType: 'село',
                      },
                      {
                        cityCode: '917477670000000001',
                        cityName: 'Большая Ижора',
                        extendedCityName: 'Ленинградская область',
                        localityType: 'город',
                      },
                    ],
                  },
                },
              });
            } else {
              await route.fulfill({
                json: {
                  data: {
                    cities: [
                      {
                        cityCode: '917477679070000000',
                        cityName: 'Москва',
                        extendedCityName: 'Москва',
                        localityType: 'город',
                      },
                      {
                        cityCode: '917484847590000000',
                        cityName: 'Казань',
                        extendedCityName: 'Республика Татарстан',
                        localityType: 'город',
                      },
                    ],
                  },
                },
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
    10_000,
  );

  return { source, requests };
}

void test('reads top cities on empty letter and combines province + query cities for a letter', async (): Promise<void> => {
  const { source, requests } = createSource();

  const session = await source.open(proxy, signal);
  const top = await session.read('', signal);
  const byLetter = await session.read('И', signal);
  const secondLetter = await session.read('А', signal);
  await session.close();

  assert.deepEqual(top, [
    { id: '917477679070000000', name: 'Москва', region: null },
    { id: '917484847590000000', name: 'Казань', region: 'Республика Татарстан' },
  ]);
  assert.deepEqual(byLetter, [
    { id: '917473757371000000', name: 'Иркутск', region: 'Иркутская область' },
    { id: '917473756578000000', name: 'Ангарск', region: 'Иркутская область' },
    { id: '917473867386000000', name: 'Иваново', region: 'Ивановская область' },
  ]);
  assert.ok(Array.isArray(secondLetter));
  // Provinces are fetched once per session.
  assert.equal(
    requests.filter((r) => r.path === '/aer-jsonapi/bl/maps/v1/address/get-province-suggests')
      .length,
    1,
  );
  assert.equal(browser.contexts().length, 0);
});

void test('connects through the given proxy and cleans up on failure', async (): Promise<void> => {
  let given: BrowserContextOptions | undefined;
  const { source } = createSource({ opens: false }, (options) => {
    given = options;
  });

  await assert.rejects(source.open(proxy, signal));
  assert.equal(given?.proxy?.server, 'socks5://217.71.230.1:1080');
  assert.equal(browser.contexts().length, 0);
});

void test('connects directly when proxy is null', async (): Promise<void> => {
  let given: BrowserContextOptions | undefined;
  const { source } = createSource({ opens: false }, (options) => {
    given = options;
  });

  await assert.rejects(source.open(null, signal));
  assert.equal(given?.proxy, undefined);
  assert.equal(browser.contexts().length, 0);
});

void test('rejects invalid or unsuccessful API responses', async (): Promise<void> => {
  const { source } = createSource({ citiesStatus: 500 });
  const session = await source.open(proxy, signal);

  await assert.rejects(session.read('', signal));
  await session.close();
  assert.equal(browser.contexts().length, 0);
});
