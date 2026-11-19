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

import { DnsBrowserCitySourceAdapter } from './dns-browser-city-source.adapter.js';

let browser: Browser;
beforeEach(async (): Promise<void> => {
  browser = await Camoufox({ headless: true });
});

afterEach(async (): Promise<void> => {
  await browser.close();
});

interface SiteInterface {
  /** Whether the site shows its pages; otherwise it keeps showing a check. */
  opens?: boolean;
  /** The answer of the API to a letter. */
  api?: (letter: string) => { status: number; body: unknown };
  /** Whether the API takes the request and never answers. */
  hangs?: boolean;
}

function createSource(
  site: SiteInterface,
  inspect?: (options: BrowserContextOptions | undefined) => void,
  timeoutMs = 10_000,
): { source: DnsBrowserCitySourceAdapter; asked: string[] } {
  const asked: string[] = [];
  const source = new DnsBrowserCitySourceAdapter(
    {
      newContext: async (options?: BrowserContextOptions): Promise<BrowserContext> => {
        inspect?.(options);
        const context = await browser.newContext(options);
        await context.route('**/*', async (route: Route): Promise<void> => {
          const url = new URL(route.request().url());
          if (url.origin === 'https://www.dns-shop.ru') {
            await route.fulfill({
              contentType: 'text/html; charset=utf-8',
              body:
                site.opens === false
                  ? '<title>Check</title>'
                  : '<div class="header-top-menu__city-selector">Москва</div>',
            });
          } else if (url.origin === 'https://restapi.dns-shop.ru') {
            const letter = url.searchParams.get('letter') ?? '';
            asked.push(letter);
            if (site.hangs === true) return;
            const answer = site.api?.(letter) ?? { status: 200, body: { data: { cities: [] } } };
            await route.fulfill({
              status: answer.status,
              json: answer.body,
              headers: {
                'access-control-allow-origin': 'https://www.dns-shop.ru',
                'access-control-allow-credentials': 'true',
              },
            });
          } else {
            await route.abort();
          }
        });

        return context;
      },
    },
    new CamoufoxOptionsFactory(),
    timeoutMs,
  );

  return { source, asked };
}

const proxy = new ProxyEndpointEntity('socks5://217.71.230.1:1080');
const signal = new AbortController().signal;

void test('opens the site once, and asks its API from the page for every letter, mapping the cities', async (): Promise<void> => {
  const { source, asked } = createSource({
    api: (letter) => ({
      status: 200,
      body: {
        message: '',
        data: {
          cities: [
            {
              id: `${letter}-1`,
              name: ` Город ${letter} `,
              regionName: 'Область',
              citySlug: 'x',
              shopUrl: '/',
            },
            { id: `${letter}-2`, name: 'Без области', regionName: '' },
          ],
        },
      },
    }),
  });

  const session = await source.open(proxy, signal);
  const first = await session.read('А', signal);
  const second = await session.read('Б', signal);
  await session.close();

  assert.deepEqual(first, [
    { id: 'А-1', name: 'Город А', region: 'Область' },
    { id: 'А-2', name: 'Без области', region: null },
  ]);
  assert.equal(second[0]?.id, 'Б-1');
  assert.deepEqual(asked, ['А', 'Б']);
  assert.equal(browser.contexts().length, 0);
});

void test('connects through the proxy it is given', async (): Promise<void> => {
  let given: BrowserContextOptions | undefined;
  const { source } = createSource({}, (options) => {
    given = options;
  });

  await (await source.open(new ProxyEndpointEntity('socks5://217.71.230.1:1080'), signal)).close();

  assert.equal(given?.proxy?.server, 'socks5://217.71.230.1:1080');
});

void test('does not open when the site keeps showing a check, and leaves no browser context behind', async (): Promise<void> => {
  const { source } = createSource({ opens: false });

  await assert.rejects(source.open(proxy, signal));
  assert.equal(browser.contexts().length, 0);
});

void test('rejects an answer that is not the list of cities, or not a success', async (): Promise<void> => {
  const answers = [
    { status: 403, body: {} },
    { status: 200, body: { data: {} } },
    { status: 200, body: { data: { cities: [{ name: 'no id' }] } } },
  ];

  for (const answer of answers) {
    const { source } = createSource({ api: () => answer });
    const session = await source.open(proxy, signal);

    await assert.rejects(session.read('А', signal));
    await session.close();
  }
});

void test('does not open when the job is already aborted', async (): Promise<void> => {
  const { source } = createSource({});

  await assert.rejects(source.open(proxy, AbortSignal.abort()));
});

void test(
  'gives up on an API that never answers, within the time it is given',
  {
    timeout: 10_000,
  },
  async (): Promise<void> => {
    const { source } = createSource({ hangs: true }, undefined, 1500);
    const session = await source.open(proxy, signal);
    const started = Date.now();

    await assert.rejects(session.read('А', signal));
    await session.close();

    assert.ok(Date.now() - started < 5000);
  },
);

void test(
  'stops waiting for the API when asked to stop',
  {
    timeout: 10_000,
  },
  async (): Promise<void> => {
    const { source } = createSource({ hangs: true });
    const session = await source.open(proxy, signal);
    const stop = new AbortController();
    setTimeout((): void => {
      stop.abort();
    }, 200);
    const started = Date.now();

    await assert.rejects(session.read('А', stop.signal));
    await session.close().catch((): void => undefined);

    assert.ok(Date.now() - started < 1200);
  },
);
