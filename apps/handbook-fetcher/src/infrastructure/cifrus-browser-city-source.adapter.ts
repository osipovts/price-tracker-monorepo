import { setTimeout as delay } from 'node:timers/promises';

import type { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type {
  CitySourcePort,
  CitySourceSessionInterface,
} from '../application/city-source.port.js';
import type { CityInterface } from '../domain/city.interface.js';

const cityIdPattern = /^[1-9]\d*$/;
const maxPages = 50;

interface CifrusCitiesPageInterface {
  status: number;
  hasChallenge: boolean;
  cities: Array<{ id: string; name: string }>;
  nextPage: number | null;
}

/** Reads the cities of Cifrus from its paginated city selector endpoint inside a browser session. */
export class CifrusBrowserCitySourceAdapter implements CitySourcePort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly timeoutMs: number,
    private readonly batchDelayMs = 200,
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
      const response = await page.goto('https://www.cifrus.ru/', {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });

      const state = await page.evaluate((): { hasChallenge: boolean; hasTrigger: boolean } => {
        const scripts = Array.from(window.document.scripts);
        const hasChallenge =
          window.document.querySelector('.g-recaptcha') !== null ||
          scripts.some(
            (script): boolean =>
              script.src.includes('google.com/recaptcha') ||
              script.textContent.includes('/unlock.php'),
          );

        return {
          hasChallenge,
          hasTrigger: window.document.getElementById('city_trigger_header') !== null,
        };
      });
      if (state.hasChallenge) throw new Error('Cifrus asked for a captcha check');
      if (response?.ok() !== true) {
        throw new Error(`Cifrus opened with HTTP ${String(response?.status() ?? 0)}`);
      }
      if (!state.hasTrigger) {
        await page.locator('#city_trigger_header').waitFor({
          state: 'attached',
          timeout: this.timeoutMs,
        });
      }

      return this.sessionOf(context, page, close);
    } catch (error: unknown) {
      await close();
      throw error;
    }
  }

  private sessionOf(
    context: BrowserContext,
    page: Page,
    close: () => Promise<void>,
  ): CitySourceSessionInterface {
    return {
      read: async (_letter, readSignal): Promise<CityInterface[]> => {
        const cities = new Map<string, CityInterface>();

        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          readSignal.throwIfAborted();
          if (pageNumber > 1 && this.batchDelayMs > 0) {
            await delay(this.batchDelayMs, undefined, { signal: readSignal });
          }

          const result = await this.fetchCitiesPage(context, page, pageNumber, readSignal);
          for (const { id, name } of result.cities) {
            if (cityIdPattern.test(id)) cities.set(id, { id, name, region: null });
          }

          if (result.nextPage === null || result.nextPage <= pageNumber) break;
        }

        if (cities.size === 0) throw new Error('Cifrus returned no cities');

        return Array.from(cities.values());
      },
      close,
    };
  }

  private async fetchCitiesPage(
    context: BrowserContext,
    page: Page,
    pageNumber: number,
    signal: AbortSignal,
  ): Promise<CifrusCitiesPageInterface> {
    const closeContext = (): void => {
      void context.close().catch((): void => {
        /* The browser may already be closed. */
      });
    };
    signal.addEventListener('abort', closeContext, { once: true });

    try {
      const result = await page.evaluate(
        async ({ pageNumber, timeoutMs }): Promise<CifrusCitiesPageInterface> => {
          const response = await fetch('/ajax/city_ajax.php', {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
            },
            body: `q=&page=${String(pageNumber)}&all=1&current_id=74507`,
            signal: AbortSignal.timeout(timeoutMs),
          });
          const html = await response.text();
          const hasChallenge = html.includes('g-recaptcha') || html.includes('/unlock.php');
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const cities: Array<{ id: string; name: string }> = [];

          for (const item of doc.querySelectorAll('.city-item')) {
            const id = item.getAttribute('data-id')?.trim() ?? '';
            const nameEl = item.querySelector('.city-name');
            if (id === '' || nameEl === null) continue;

            const name = Array.from(nameEl.childNodes)
              .filter((node): boolean => node.nodeType === Node.TEXT_NODE)
              .map((node): string => node.textContent ?? '')
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (name !== '') cities.push({ id, name });
          }

          const nextRaw =
            doc.querySelector('.city-load-more')?.getAttribute('data-page')?.trim() ?? '';
          const nextPage = /^\d+$/.test(nextRaw) ? Number(nextRaw) : null;

          return { status: response.status, hasChallenge, cities, nextPage };
        },
        { pageNumber, timeoutMs: this.timeoutMs },
      );

      if (result.hasChallenge) throw new Error('Cifrus cities: captcha required');
      if (result.status !== 200) throw new Error(`Cifrus cities: HTTP ${String(result.status)}`);

      return result;
    } finally {
      signal.removeEventListener('abort', closeContext);
    }
  }
}
