import { randomUUID } from 'node:crypto';

import type { CamoufoxOptionsFactory } from 'camoufox-options';
import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { Browser, BrowserContext, Page, Response } from 'playwright-core';
import {
  marketplaceDefaultCities,
  marketplaceExitCountries,
  type ProductReferenceEntity,
} from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';
import { z } from 'zod';

import type { ProductReaderPort } from '../../application/product/product-reader.port.js';
import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import type { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { ProxyExitChecker } from '../shared/proxy-exit.checker.js';
import type { SportmasterPageParser } from './sportmaster-page.parser.js';
import type { SportmasterProductParser } from './sportmaster-product.parser.js';

const citiesSchema = z.object({
  cities: z.array(
    z.object({
      cityId: z.string(),
      cityName: z.string(),
      geoPoint: z.object({ lat: z.number(), lon: z.number() }),
    }),
  ),
});

export interface SportmasterReaderParsersInterface {
  geoIp: GeoIpPageParser;
  pages: SportmasterPageParser;
  products: SportmasterProductParser;
}

export class SportmasterPlaywrightProductReaderAdapter implements ProductReaderPort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly parsers: SportmasterReaderParsersInterface,
    private readonly timeoutMs: number,
    private readonly logger: LoggerPort = silentLogger,
    private readonly exits: ProxyExitChecker = new ProxyExitChecker(),
  ) {}

  async read(
    reference: ProductReferenceEntity,
    proxy: ProxyEndpointEntity | null,
    signal: AbortSignal,
  ): Promise<ReadProductResultType> {
    signal.throwIfAborted();
    const route = proxy?.server ?? 'direct connection';
    this.logger.debug(`Opening a browser context via ${route}`);

    let context: BrowserContext | undefined;
    const abort = (): void => {
      void context?.close().catch((): void => {
        /* Already closed by browser shutdown. */
      });
    };
    try {
      context = await this.browser.newContext({
        ...this.options.context(proxy),
        acceptDownloads: false,
      });
      signal.throwIfAborted();
      signal.addEventListener('abort', abort, { once: true });
      context.setDefaultTimeout(this.timeoutMs);
      context.setDefaultNavigationTimeout(this.timeoutMs);

      const result = await this.readPage(reference, proxy, context);
      signal.throwIfAborted();

      return result;
    } catch (error: unknown) {
      signal.throwIfAborted();
      const detail = errorMessage(error).split('\n')[0] ?? '';
      this.logger.warn(`Browser error via ${route}: ${detail}`);

      return { status: 'network_error', ...(detail === '' ? {} : { detail }) };
    } finally {
      signal.removeEventListener('abort', abort);
      await context?.close().catch((error: unknown): void => {
        this.logger.debug(
          `Could not close browser context: ${errorMessage(error).split('\n')[0] ?? ''}`,
        );
      });
    }
  }

  private async readPage(
    reference: ProductReferenceEntity,
    proxy: ProxyEndpointEntity | null,
    context: BrowserContext,
  ): Promise<ReadProductResultType> {
    const page = await context.newPage();
    let exitIp: string | null = null;
    if (proxy !== null) {
      const country = marketplaceExitCountries[reference.marketplace];
      const exit = await this.exits.check(proxy, country, () => this.parsers.geoIp.parse(page));
      if (exit.status === 'unavailable') {
        this.logger.warn(`GeoIP gave no answer through ${proxy.server}`);

        return { status: 'network_error', stage: 'exit' };
      }
      if (exit.status === 'rejected') {
        this.logger.warn(`GeoIP did not confirm an exit in ${country} through ${proxy.server}`);

        return { status: 'proxy_rejected', stage: 'exit' };
      }

      exitIp = exit.exitIp;
      this.logger.debug(`Exit IP through ${proxy.server} is ${exitIp} (${country})`);
    }

    const lastResponse = this.watch(page);
    await page.goto(reference.url, { waitUntil: 'commit' });
    let document = await this.parsers.pages.parse(page);
    const defaultCity = marketplaceDefaultCities.sportmaster;
    const cityId = reference.cityId ?? defaultCity?.id;
    const cityName =
      reference.cityName ?? (cityId === defaultCity?.id ? defaultCity?.name : undefined);

    if (!document.hasChallenge && lastResponse()?.ok() === true && cityId !== document.cityId) {
      if (
        cityId === undefined ||
        cityName === undefined ||
        new URL(document.url).origin !== new URL(reference.url).origin ||
        !(await this.chooseCity(page, cityId, cityName))
      ) {
        this.logger.warn(`Could not select Sportmaster city ${cityId ?? ''}`);

        return { status: 'parse_error' };
      }

      await page.reload({ waitUntil: 'commit' });
      document = await this.parsers.pages.parse(page);
    }
    if (document.hasChallenge) {
      this.logger.warn(
        `The Qrator check was not passed via ${proxy?.server ?? 'direct connection'}`,
      );

      return { status: 'challenge_required' };
    }

    const response = lastResponse();
    if (response === null) return { status: 'network_error' };
    if (!response.ok()) {
      this.logger.warn(`HTTP ${String(response.status())} instead of the product page`);

      return { status: 'http_error', httpStatus: response.status() };
    }

    if (document.cityId !== cityId) {
      this.logger.warn(
        `The page is of the city ${String(document.cityId)}, not of ${cityId ?? ''}`,
      );

      return { status: 'parse_error' };
    }

    const snapshot = this.parsers.products.parse(reference, document);
    if (snapshot === null) {
      this.logger.warn('The product card could not be parsed');

      return { status: 'parse_error' };
    }

    this.logger.debug(
      `Parsed "${snapshot.title.slice(0, 60)}": ${String(snapshot.prices.length)} prices, ${snapshot.availability}`,
    );

    return {
      status: snapshot.prices.length > 0 ? 'success' : 'partial',
      snapshot,
      exitIp,
    };
  }

  private async chooseCity(page: Page, cityId: string, cityName: string): Promise<boolean> {
    const body: unknown = await page.evaluate(
      async ({ cityName, timeoutMs }): Promise<unknown> => {
        const url = `/web-api/v1/cities?text=${encodeURIComponent(cityName)}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error(`Sportmaster cities: HTTP ${String(response.status)}`);

        return response.json();
      },
      { cityName, timeoutMs: this.timeoutMs },
    );
    const city = citiesSchema.parse(body).cities.find((city): boolean => city.cityId === cityId);
    if (city === undefined) return false;

    return page.evaluate(
      async ({ city, requestId, timeoutMs }): Promise<boolean> => {
        const response = await fetch('/web-api/v1/profiles/current/location', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-SM-Accept-Lang': 'ru-RU',
            'X-SM-Page-Type': 'PRODUCT',
            'X-SM-Request-Id': requestId,
          },
          body: JSON.stringify({
            geoPoint: city.geoPoint,
            locationLevel: 'OTHER',
            locationName: city.cityName,
            name: city.cityName,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        });

        return response.ok;
      },
      { city, requestId: randomUUID(), timeoutMs: this.timeoutMs },
    );
  }

  /** The response of the last main-frame navigation: Qrator may reload the product after its first answer. */
  private watch(page: Page): () => Response | null {
    let response: Response | null = null;
    page.on('response', (received): void => {
      if (received.request().isNavigationRequest() && received.frame() === page.mainFrame())
        response = received;
    });

    return (): Response | null => response;
  }
}
