import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { Camoufox } from 'camoufox-js';
import { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, BrowserContextOptions, Route } from 'playwright-core';

import { SportmasterBrowserCitySourceAdapter } from './sportmaster-browser-city-source.adapter.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

const signal = new AbortController().signal;

function createSource(
  responses: Readonly<Record<string, unknown>>,
  seedCities: readonly string[] = [],
): {
  source: SportmasterBrowserCitySourceAdapter;
  requestedPaths: string[];
} {
  const requestedPaths: string[] = [];
  const source = new SportmasterBrowserCitySourceAdapter(
    {
      newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
        const context = await browser.newContext(options);
        await context.route('**/*', async (route: Route): Promise<void> => {
          const url = new URL(route.request().url());
          const path = `${url.pathname}${url.search}`;
          if (url.origin === 'https://www.sportmaster.ru' && url.pathname === '/') {
            await route.fulfill({
              contentType: 'text/html; charset=utf-8',
              body: '<button data-selenium="cityButton">Москва</button>',
            });

            return;
          }

          if (url.origin === 'https://www.sportmaster.ru' && path in responses) {
            requestedPaths.push(path);
            await route.fulfill({ json: responses[path] });

            return;
          }

          await route.abort();
        });

        return context;
      },
    },
    new CamoufoxOptionsFactory(),
    15_000,
    seedCities,
  );

  return { source, requestedPaths };
}

void test('reads top and shop cities for the empty letter', async (): Promise<void> => {
  const { source } = createSource({
    '/web-api/v1/location/top-cities': {
      cities: [{ id: '1720920299', name: 'Москва' }],
    },
    '/web-api/v1/shops?status=IS_OPEN': {
      shops: [{ territory: { id: '30970299', name: 'Иркутск' } }],
    },
  });
  const session = await source.open(null, signal);

  try {
    const cities = await session.read('', signal);

    assert.deepEqual(cities, [
      { id: '1720920299', name: 'Москва', region: null },
      { id: '30970299', name: 'Иркутск', region: null },
    ]);
  } finally {
    await session.close();
  }
});

void test('queries seed cities for the requested letter and deduplicates results', async (): Promise<void> => {
  const queryI = `/web-api/v1/cities?text=${encodeURIComponent('И')}`;
  const queryIrkutsk = `/web-api/v1/cities?text=${encodeURIComponent('Иркутск')}`;
  const queryIzhevsk = `/web-api/v1/cities?text=${encodeURIComponent('Ижевск')}`;
  const { source, requestedPaths } = createSource(
    {
      [queryI]: {
        cities: [
          { cityId: '1', cityName: 'Серп и Молот', macrocity: 'Волгоградская область' },
          { cityId: '2', cityName: 'Иж-Бобья', macrocity: 'Республика Татарстан' },
          { cityId: '30970299', cityName: 'Иркутск', macrocity: 'Иркутская область' },
        ],
      },
      [queryIrkutsk]: {
        cities: [
          { cityId: '30970299', cityName: 'Иркутск', macrocity: 'Иркутская область' },
          { cityId: '3', cityName: 'Иркутский', macrocity: '' },
        ],
      },
      [queryIzhevsk]: {
        cities: [{ cityId: '28560299', cityName: 'Ижевск', macrocity: 'Республика Удмуртская' }],
      },
    },
    ['Иркутск', 'Ижевск', 'Кемерово'],
  );
  const session = await source.open(null, signal);

  try {
    const cities = await session.read('И', signal);

    assert.deepEqual(requestedPaths.toSorted(), [queryI, queryIrkutsk, queryIzhevsk].toSorted());
    assert.deepEqual(cities, [
      { id: '2', name: 'Иж-Бобья', region: 'Республика Татарстан' },
      { id: '30970299', name: 'Иркутск', region: 'Иркутская область' },
      { id: '3', name: 'Иркутский', region: null },
      { id: '28560299', name: 'Ижевск', region: 'Республика Удмуртская' },
    ]);
  } finally {
    await session.close();
  }
});
