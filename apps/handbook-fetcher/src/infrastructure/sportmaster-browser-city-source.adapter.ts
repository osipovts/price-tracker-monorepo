import type { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, Page } from 'playwright-core';
import type { ProxyEndpointEntity } from 'proxy-endpoint';
import { z } from 'zod';

import type {
  CitySourcePort,
  CitySourceSessionInterface,
} from '../application/city-source.port.js';
import type { CityInterface } from '../domain/city.interface.js';

const citySchema = z.object({ id: z.string().min(1), name: z.string().trim().min(1) });
const topCitiesSchema = z.object({ cities: z.array(citySchema).min(1) });
const shopsSchema = z.object({ shops: z.array(z.object({ territory: citySchema })) });
const searchCitiesSchema = z.object({
  cities: z.array(
    z.object({
      cityId: z.string().min(1),
      cityName: z.string().trim().min(1),
      macrocity: z.string().trim().nullish(),
    }),
  ),
});

const queryBatchSize = 6;

export class SportmasterBrowserCitySourceAdapter implements CitySourcePort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly timeoutMs: number,
    /** Known city names queried alongside each letter so major cities are not lost to the 100-item search cap. */
    private readonly seedCities: readonly string[] = [],
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
      await page.goto('https://www.sportmaster.ru/', {
        waitUntil: 'commit',
        timeout: this.timeoutMs,
      });
      await page.locator('[data-selenium="cityButton"]').first().waitFor({
        state: 'attached',
        timeout: this.timeoutMs,
      });

      return {
        read: async (letter, readSignal): Promise<CityInterface[]> => {
          readSignal.throwIfAborted();
          if (letter === '') return this.readTopAndShopCities(page);

          return this.readByLetter(page, letter, readSignal);
        },
        close,
      };
    } catch (error: unknown) {
      await close();
      throw error;
    }
  }

  private async readByLetter(
    page: Page,
    letter: string,
    signal: AbortSignal,
  ): Promise<CityInterface[]> {
    const queries = Array.from(
      new Set([
        letter,
        ...this.seedCities.filter((name): boolean =>
          name.toLocaleUpperCase('ru').startsWith(letter),
        ),
      ]),
    );
    const cities = new Map<string, CityInterface>();

    for (let index = 0; index < queries.length; index += queryBatchSize) {
      signal.throwIfAborted();
      const batch = queries.slice(index, index + queryBatchSize);
      const responses = await Promise.all(
        batch.map((query): Promise<unknown> =>
          this.readJson(page, `/web-api/v1/cities?text=${encodeURIComponent(query)}`),
        ),
      );

      for (const body of responses) {
        for (const { cityId, cityName, macrocity } of searchCitiesSchema.parse(body).cities) {
          if (!cityName.toLocaleUpperCase('ru').startsWith(letter)) continue;

          cities.set(cityId, {
            id: cityId,
            name: cityName,
            region: macrocity === '' ? null : (macrocity ?? null),
          });
        }
      }
    }

    return Array.from(cities.values());
  }

  private async readTopAndShopCities(page: Page): Promise<CityInterface[]> {
    // The search response is capped. Store cities in the site's current region fill some of the gaps.
    const [popular, shops] = await Promise.all([
      this.readJson(page, '/web-api/v1/location/top-cities'),
      this.readJson(page, '/web-api/v1/shops?status=IS_OPEN'),
    ]);
    const cities = [
      ...topCitiesSchema.parse(popular).cities,
      ...shopsSchema
        .parse(shops)
        .shops.map(({ territory }): z.infer<typeof citySchema> => territory),
    ];

    return cities.map(({ id, name }): CityInterface => ({ id, name, region: null }));
  }

  private readJson(page: Page, path: string): Promise<unknown> {
    return page.evaluate(
      async ({ path, timeoutMs }): Promise<unknown> => {
        const response = await fetch(path, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error(`Sportmaster cities: HTTP ${String(response.status)}`);

        return response.json();
      },
      { path, timeoutMs: this.timeoutMs },
    );
  }
}
