import type { CamoufoxOptionsFactory } from 'camoufox-options';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { ProxyEndpointEntity } from 'proxy-endpoint';
import { z } from 'zod';

import type {
  CitySourcePort,
  CitySourceSessionInterface,
} from '../application/city-source.port.js';
import type { CityInterface } from '../domain/city.interface.js';

const provinceSchema = z.object({
  code: z.string().min(1),
  name: z.string().trim().min(1),
});
const provincesResponseSchema = z.object({
  data: z.object({
    provinces: z.array(provinceSchema),
  }),
});
const citySchema = z.object({
  cityCode: z.string().min(1),
  cityName: z.string().trim().min(1),
  extendedCityName: z.string().trim().nullish(),
  localityType: z.string().trim().nullish(),
});
const citiesResponseSchema = z.object({
  data: z.object({
    cities: z.array(citySchema),
  }),
});

type AliexpressProvinceType = z.infer<typeof provinceSchema>;
type AliexpressCityType = z.infer<typeof citySchema>;

/** Reads the Russian cities of AliExpress from its address suggest endpoints inside a browser session. */
export class AliexpressBrowserCitySourceAdapter implements CitySourcePort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly timeoutMs: number,
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
      await page.goto('https://aliexpress.ru/', {
        waitUntil: 'commit',
        timeout: this.timeoutMs,
      });
      await page.locator('[class*="ShipToHeaderItem__container"]').first().waitFor({
        state: 'attached',
        timeout: this.timeoutMs,
      });

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
    let provinces: readonly AliexpressProvinceType[] | null = null;

    return {
      read: async (letter, readSignal): Promise<CityInterface[]> => {
        readSignal.throwIfAborted();
        if (letter === '') return this.readTopCities(context, page, readSignal);

        provinces ??= await this.readProvinces(context, page, readSignal);
        const matchingProvinces = provinces.filter(({ name }): boolean =>
          name.toLocaleUpperCase('ru').startsWith(letter),
        );

        const provinceCityLists = await Promise.all(
          matchingProvinces.map((province): Promise<AliexpressCityType[]> =>
            this.fetchCities(context, page, { provinceCode: province.code }, readSignal),
          ),
        );
        const queriedCities = (
          await this.fetchCities(context, page, { query: letter }, readSignal)
        ).filter(
          ({ cityName, localityType }): boolean =>
            localityType === 'город' && cityName.toLocaleUpperCase('ru').startsWith(letter),
        );

        const cities = new Map<string, CityInterface>();
        for (const city of [...provinceCityLists.flat(), ...queriedCities]) {
          cities.set(city.cityCode, this.mapCity(city));
        }

        return Array.from(cities.values());
      },
      close,
    };
  }

  private async readTopCities(
    context: BrowserContext,
    page: Page,
    signal: AbortSignal,
  ): Promise<CityInterface[]> {
    const cities = await this.fetchCities(context, page, {}, signal);

    return cities.map((city): CityInterface => this.mapCity(city));
  }

  private async readProvinces(
    context: BrowserContext,
    page: Page,
    signal: AbortSignal,
  ): Promise<AliexpressProvinceType[]> {
    const body = await this.postJson(
      context,
      page,
      '/aer-jsonapi/bl/maps/v1/address/get-province-suggests',
      { query: '', countryCode: 'RU' },
      signal,
    );

    return provincesResponseSchema.parse(body).data.provinces;
  }

  private async fetchCities(
    context: BrowserContext,
    page: Page,
    filter: { provinceCode?: string; query?: string },
    signal: AbortSignal,
  ): Promise<AliexpressCityType[]> {
    const body = await this.postJson(
      context,
      page,
      '/aer-jsonapi/bl/maps/v1/address/get-city-suggests',
      { countryCode: 'RU', inputLocale: 'ru_RU', ...filter },
      signal,
    );

    return citiesResponseSchema.parse(body).data.cities;
  }

  private mapCity({ cityCode, cityName, extendedCityName }: AliexpressCityType): CityInterface {
    return {
      id: cityCode,
      name: cityName,
      region:
        extendedCityName === undefined ||
        extendedCityName === null ||
        extendedCityName === '' ||
        extendedCityName === cityName
          ? null
          : extendedCityName,
    };
  }

  private async postJson(
    context: BrowserContext,
    page: Page,
    path: string,
    payload: Record<string, string>,
    signal: AbortSignal,
  ): Promise<unknown> {
    const closeContext = (): void => {
      void context.close().catch((): void => {
        /* The browser may already be closed. */
      });
    };
    signal.addEventListener('abort', closeContext, { once: true });

    try {
      return await page.evaluate(
        async ({ path, payload, timeoutMs }): Promise<unknown> => {
          const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok) throw new Error(`AliExpress cities: HTTP ${String(response.status)}`);

          return response.json();
        },
        { path, payload, timeoutMs: this.timeoutMs },
      );
    } finally {
      signal.removeEventListener('abort', closeContext);
    }
  }
}
