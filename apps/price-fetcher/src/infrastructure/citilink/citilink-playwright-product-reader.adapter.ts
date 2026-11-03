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
import type { CitilinkPageParser } from './citilink-page.parser.js';
import type { CitilinkProductParser } from './citilink-product.parser.js';
import type { CitilinkStateParser } from './citilink-state.parser.js';

export interface CitilinkReaderParsersInterface {
  geoIp: GeoIpPageParser;
  pages: CitilinkPageParser;
  states: CitilinkStateParser;
  products: CitilinkProductParser;
}

export class CitilinkPlaywrightProductReaderAdapter implements ProductReaderPort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly parsers: CitilinkReaderParsersInterface,
    private readonly timeoutMs: number,
    private readonly logger: LoggerPort = silentLogger,
    private readonly exits: ProxyExitChecker = new ProxyExitChecker(),
  ) {}

  async read(
    reference: ProductReferenceEntity,
    proxy: ProxyEndpointEntity,
    signal: AbortSignal,
  ): Promise<ReadProductResultType> {
    signal.throwIfAborted();
    const route = proxy.server;
    this.logger.debug(`Opening a browser context via ${route}`);

    const context = await this.browser.newContext({
      ...this.options.context(proxy),
      acceptDownloads: false,
    });
    const abort = (): void => {
      void context.close().catch((): void => {
        /* Already closed by browser shutdown. */
      });
    };
    signal.addEventListener('abort', abort, { once: true });
    context.setDefaultTimeout(this.timeoutMs);
    context.setDefaultNavigationTimeout(this.timeoutMs);

    try {
      return await this.readPage(reference, proxy, context);
    } catch (error: unknown) {
      signal.throwIfAborted();
      this.logger.warn(`Browser error via ${route}: ${errorMessage(error).split('\n')[0] ?? ''}`);

      return { status: 'network_error' };
    } finally {
      signal.removeEventListener('abort', abort);
      await context.close();
    }
  }

  private async readPage(
    reference: ProductReferenceEntity,
    proxy: ProxyEndpointEntity,
    context: BrowserContext,
  ): Promise<ReadProductResultType> {
    const page = await context.newPage();
    const country = marketplaceExitCountries[reference.marketplace];
    const exit = await this.exits.check(proxy, country, () => this.parsers.geoIp.parse(page));
    if (exit.status === 'unavailable') {
      this.logger.warn(`GeoIP gave no answer through ${proxy.server}`);

      return { status: 'network_error' };
    }
    if (exit.status === 'rejected') {
      this.logger.warn(`GeoIP did not confirm an exit in ${country} through ${proxy.server}`);

      return { status: 'proxy_rejected' };
    }

    const exitIp = exit.exitIp;
    this.logger.debug(`Exit IP through ${proxy.server} is ${exitIp} (${country})`);

    // Without a city the site guesses one by the address of the visitor: the default city stands for none.
    const cityId = reference.cityId ?? marketplaceDefaultCities.citilink?.id ?? null;
    if (cityId !== null) await this.chooseCity(context, cityId);

    const lastResponse = this.watch(page);
    await page.goto(reference.url, { waitUntil: 'domcontentloaded' });
    const document = await this.parsers.pages.parse(page);
    const response = lastResponse();
    if (response === null) return { status: 'network_error' };
    if (!response.ok()) {
      this.logger.warn(`HTTP ${String(response.status())} instead of the product page`);

      return { status: 'http_error', httpStatus: response.status() };
    }

    const renderedCityId = this.parsers.states.parse(document.state)?.cityId ?? null;
    if (cityId !== null && renderedCityId !== cityId) {
      this.logger.warn(`The page is of the city ${String(renderedCityId)}, not of ${cityId}`);

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
      // A card without a price is read too: the product may be out of stock.
      status: snapshot.prices.length > 0 ? 'success' : 'partial',
      snapshot,
      exitIp,
    };
  }

  /** Does what the city selector of the site does: the city of the visitor is kept in the cookie `_space`. */
  private chooseCity(context: BrowserContext, cityId: string): Promise<void> {
    return context.addCookies([
      { name: '_space', value: encodeURIComponent(cityId), domain: '.citilink.ru', path: '/' },
    ]);
  }

  /** The response of the last main-frame navigation at the time it is called: a challenge may redirect after the load. */
  private watch(page: Page): () => Response | null {
    let response: Response | null = null;
    page.on('response', (received): void => {
      if (received.request().isNavigationRequest() && received.frame() === page.mainFrame())
        response = received;
    });

    return (): Response | null => response;
  }
}
