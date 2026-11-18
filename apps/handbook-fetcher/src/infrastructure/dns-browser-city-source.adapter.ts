import type { CamoufoxOptionsFactory } from 'camoufox-options';
import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { ProxyEndpointEntity } from 'proxy-endpoint';
import { z } from 'zod';

import type {
  CitySourcePort,
  CitySourceSessionInterface,
} from '../application/city-source.port.js';
import type { CityInterface } from '../domain/city.interface.js';

const answerSchema = z.object({
  data: z.object({
    cities: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1),
        regionName: z.string().trim().optional(),
      }),
    ),
  }),
});

/**
 * The site of DNS lets a visitor ask its API for the cities only after its own page has been opened and
 * its check has passed. The cities are read the way the city selector of the site does it: in a browser,
 * with the page open, by the first letter of the name.
 */
export class DnsBrowserCitySourceAdapter implements CitySourcePort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly timeoutMs: number,
    private readonly logger: LoggerPort = silentLogger,
    private readonly siteUrl = 'https://www.dns-shop.ru/',
    private readonly apiUrl = 'https://restapi.dns-shop.ru/',
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

    try {
      const page = await context.newPage();
      await page.goto(this.siteUrl, { waitUntil: 'domcontentloaded' });
      // The pages of the site have the city selector in their header; a check has none.
      await page.locator('.header-top-menu__city-selector').first().waitFor({ state: 'visible' });
      this.logger.debug(`Opened ${this.siteUrl} via ${proxy?.server ?? 'direct connection'}`);

      return this.sessionOf(context, page);
    } catch (error: unknown) {
      this.logger.debug(`Could not open the site: ${errorMessage(error).split('\n')[0] ?? ''}`);
      await context.close();
      throw error;
    }
  }

  private sessionOf(context: BrowserContext, page: Page): CitySourceSessionInterface {
    return {
      read: async (letter, signal): Promise<CityInterface[]> => {
        signal.throwIfAborted();
        const url = new URL(
          `/v1/site/get-cities-by-letter?letter=${encodeURIComponent(letter)}`,
          this.apiUrl,
        ).href;
        // A read that never gets its answer would hold the job: it ends with the time given, or with the job.
        const closeContext = (): void => {
          void context.close();
        };
        signal.addEventListener('abort', closeContext, { once: true });
        let answer: { status: number; body: string };
        try {
          answer = await page.evaluate(
            async ({ target, timeoutMs }): Promise<{ status: number; body: string }> => {
              const response = await fetch(target, {
                credentials: 'include',
                signal: AbortSignal.timeout(timeoutMs),
              });

              return { status: response.status, body: await response.text() };
            },
            { target: url, timeoutMs: this.timeoutMs },
          );
        } finally {
          signal.removeEventListener('abort', closeContext);
        }
        if (answer.status !== 200) throw new Error(`The API answered ${String(answer.status)}`);

        return answerSchema
          .parse(JSON.parse(answer.body))
          .data.cities.map(({ id, name, regionName }): CityInterface => ({
            id,
            name,
            region: regionName === undefined || regionName === '' ? null : regionName,
          }));
      },
      close: async (): Promise<void> => {
        await context.close();
      },
    };
  }
}
