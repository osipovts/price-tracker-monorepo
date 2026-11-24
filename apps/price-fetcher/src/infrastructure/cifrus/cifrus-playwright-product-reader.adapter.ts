import type { CamoufoxOptionsFactory } from 'camoufox-options';
import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { Browser, BrowserContext, Page, Response } from 'playwright-core';
import {
  marketplaceDefaultCities,
  marketplaceExitCountries,
  type ProductReferenceEntity,
} from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ProductReaderPort } from '../../application/product/product-reader.port.js';
import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import type { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { ProxyExitChecker } from '../shared/proxy-exit.checker.js';
import type { CifrusPageParser } from './cifrus-page.parser.js';
import type { CifrusProductParser } from './cifrus-product.parser.js';

const cityIdPattern = /^[1-9]\d*$/;

export interface CifrusReaderParsersInterface {
  geoIp: GeoIpPageParser;
  pages: CifrusPageParser;
  products: CifrusProductParser;
}

export class CifrusPlaywrightProductReaderAdapter implements ProductReaderPort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly parsers: CifrusReaderParsersInterface,
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
    const cityId = reference.cityId ?? marketplaceDefaultCities.cifrus?.id ?? null;
    if (cityId === null || !cityIdPattern.test(cityId)) {
      this.logger.warn(`Invalid Cifrus city ${String(cityId)}`);

      return { status: 'parse_error' };
    }

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

      const result = await this.readPage(reference, cityId, proxy, context);
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
    cityId: string,
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

    await this.chooseCity(context, cityId);

    const lastResponse = this.watch(page);
    await page.goto(reference.url, { waitUntil: 'domcontentloaded' });
    const document = await this.parsers.pages.parse(page);
    // Cifrus serves its reCAPTCHA block page with HTTP 403, so detect the challenge before status checks.
    if (document.hasChallenge) {
      this.logger.warn(
        `The reCAPTCHA check was not passed via ${proxy?.server ?? 'direct connection'}`,
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
      this.logger.warn(`The page is of the city ${String(document.cityId)}, not of ${cityId}`);

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

  private chooseCity(context: BrowserContext, cityId: string): Promise<void> {
    return context.addCookies([
      { name: 'cdek_city_id', value: cityId, domain: '.cifrus.ru', path: '/' },
      { name: 'cifrus_city_confirmed', value: '1', domain: '.cifrus.ru', path: '/' },
    ]);
  }

  private watch(page: Page): () => Response | null {
    let response: Response | null = null;
    page.on('response', (received): void => {
      if (received.request().isNavigationRequest() && received.frame() === page.mainFrame()) {
        response = received;
      }
    });

    return (): Response | null => response;
  }
}
