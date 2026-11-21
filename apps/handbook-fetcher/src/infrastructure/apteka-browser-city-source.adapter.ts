import { setTimeout as delay } from 'node:timers/promises';

import type { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { ProxyEndpointEntity } from 'proxy-endpoint';
import { z } from 'zod';

import type {
  CitySourcePort,
  CitySourceSessionInterface,
} from '../application/city-source.port.js';
import type { CityInterface } from '../domain/city.interface.js';

const citySlugPattern = /^[a-z0-9_-]+$/;
const batchSize = 2;

const cityUrlEntrySchema = z.object({
  id: z.string().min(1),
  url: z.string().regex(citySlugPattern),
  name: z.string().trim().min(1),
});
const cityUrlsResponseSchema = z.array(cityUrlEntrySchema);
const cityDetailSchema = z.object({
  url: z.string().regex(citySlugPattern),
  name: z.string().trim().min(1),
  state: z.string().trim().nullish(),
});

type AptekaCityUrlType = z.infer<typeof cityUrlEntrySchema>;

/** Reads the cities of Apteka.ru from `api.apteka.ru` using session headers established on `apteka.ru`. */
export class AptekaBrowserCitySourceAdapter implements CitySourcePort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly timeoutMs: number,
    private readonly batchDelayMs = 120,
  ) {}

  async open(
    proxy: ProxyEndpointEntity | null,
    signal: AbortSignal,
  ): Promise<CitySourceSessionInterface> {
    signal.throwIfAborted();
    const context = await this.browser.newContext({
      ...this.options.context(proxy),
      acceptDownloads: false,
    });
    context.setDefaultTimeout(this.timeoutMs);
    context.setDefaultNavigationTimeout(this.timeoutMs);
    const abort = (): void => {
      void context.close().catch((): void => {
        /* The browser may already be closed. */
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    const close = async (): Promise<void> => {
      signal.removeEventListener('abort', abort);
      await context.close();
    };

    try {
      signal.throwIfAborted();
      const page = await context.newPage();
      await page.goto('https://apteka.ru/', {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });
      await page.waitForFunction(
        (): boolean =>
          document.cookie.includes('user-session-id.v5=') &&
          document.cookie.includes('device-id.v4='),
        undefined,
        { timeout: this.timeoutMs },
      );

      const headers = await page.evaluate((): Record<string, string> => {
        const cookies = new Map<string, string>();
        for (const pair of document.cookie.split('; ')) {
          const separator = pair.indexOf('=');
          if (separator > 0) {
            cookies.set(pair.slice(0, separator), decodeURIComponent(pair.slice(separator + 1)));
          }
        }

        return {
          'user-session-id': cookies.get('user-session-id.v5') ?? '',
          'device-id': cookies.get('device-id.v4') ?? '',
        };
      });
      if ((headers['user-session-id'] ?? '') === '' || (headers['device-id'] ?? '') === '') {
        throw new Error('Apteka.ru did not issue session cookies');
      }

      return this.sessionOf(context, page, headers, close);
    } catch (error: unknown) {
      await close();
      throw error;
    }
  }

  private sessionOf(
    context: BrowserContext,
    page: Page,
    headers: Record<string, string>,
    close: () => Promise<void>,
  ): CitySourceSessionInterface {
    let cityUrls: readonly AptekaCityUrlType[] | null = null;

    return {
      read: async (letter, readSignal): Promise<CityInterface[]> => {
        readSignal.throwIfAborted();
        cityUrls ??= await this.fetchCityUrls(context, page, headers, readSignal);

        const matching = cityUrls.filter((entry): boolean =>
          entry.name.toLocaleUpperCase('ru').startsWith(letter),
        );
        const cities = new Map<string, CityInterface>();

        for (let index = 0; index < matching.length; index += batchSize) {
          readSignal.throwIfAborted();
          if (index > 0 && this.batchDelayMs > 0) {
            await delay(this.batchDelayMs, undefined, { signal: readSignal });
          }

          const batch = matching.slice(index, index + batchSize);
          const details = await Promise.all(
            batch.map((entry): Promise<CityInterface | null> =>
              this.fetchCityDetail(context, page, headers, entry.url, readSignal),
            ),
          );
          for (const city of details) {
            if (city !== null) cities.set(city.id, city);
          }
        }

        return Array.from(cities.values());
      },
      close,
    };
  }

  private async fetchCityUrls(
    context: BrowserContext,
    page: Page,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<AptekaCityUrlType[]> {
    const answer = await this.getJson(context, page, headers, '/City/CitiesUrls', signal);
    if (answer.status !== 200) throw new Error(`Apteka.ru cities: HTTP ${String(answer.status)}`);

    return cityUrlsResponseSchema.parse(JSON.parse(answer.body));
  }

  private async fetchCityDetail(
    context: BrowserContext,
    page: Page,
    headers: Record<string, string>,
    cityUrl: string,
    signal: AbortSignal,
  ): Promise<CityInterface | null> {
    const answer = await this.getJson(
      context,
      page,
      headers,
      `/City?url=${encodeURIComponent(cityUrl)}`,
      signal,
    );
    if (answer.status === 204 || answer.status === 404) return null;
    if (answer.status !== 200) {
      throw new Error(`Apteka.ru city ${cityUrl}: HTTP ${String(answer.status)}`);
    }

    const { url, name, state } = cityDetailSchema.parse(JSON.parse(answer.body));

    return {
      id: url,
      name,
      region:
        state === undefined || state === null || state === '' || state === name ? null : state,
    };
  }

  private async getJson(
    context: BrowserContext,
    page: Page,
    headers: Record<string, string>,
    path: string,
    signal: AbortSignal,
  ): Promise<{ status: number; body: string }> {
    const closeContext = (): void => {
      void context.close().catch((): void => {
        /* The browser may already be closed. */
      });
    };
    signal.addEventListener('abort', closeContext, { once: true });

    try {
      return await page.evaluate(
        async ({ url, requestHeaders, timeoutMs }): Promise<{ status: number; body: string }> => {
          const response = await fetch(url, {
            credentials: 'include',
            headers: requestHeaders,
            signal: AbortSignal.timeout(timeoutMs),
          });

          return { status: response.status, body: await response.text() };
        },
        { url: `https://api.apteka.ru${path}`, requestHeaders: headers, timeoutMs: this.timeoutMs },
      );
    } finally {
      signal.removeEventListener('abort', closeContext);
    }
  }
}
