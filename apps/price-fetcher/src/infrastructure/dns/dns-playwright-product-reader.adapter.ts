import type { CamoufoxOptionsFactory } from 'camoufox-options';
import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { BrowserContext, Page, Response } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { marketplaceExitCountries, type ProductReferenceEntity } from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ProductReaderPort } from '../../application/product/product-reader.port.js';
import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import type { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { ProxyExitChecker } from '../shared/proxy-exit.checker.js';
import type { DnsCityCookieParser } from './dns-city-cookie.parser.js';
import type { DnsPageInterface } from './dns-page.interface.js';
import type { DnsPageParser } from './dns-page.parser.js';
import type { DnsProductParser } from './dns-product.parser.js';

export interface DnsReaderParsersInterface {
  geoIp: GeoIpPageParser;
  pages: DnsPageParser;
  products: DnsProductParser;
  cities: DnsCityCookieParser;
}

export class DnsPlaywrightProductReaderAdapter implements ProductReaderPort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly parsers: DnsReaderParsersInterface,
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

      return { status: 'network_error', stage: 'exit' };
    }
    if (exit.status === 'rejected') {
      this.logger.warn(`GeoIP did not confirm an exit in ${country} through ${proxy.server}`);

      return { status: 'proxy_rejected', stage: 'exit' };
    }

    const exitIp = exit.exitIp;

    const lastResponse = this.watch(page);
    await page.goto(reference.url, { waitUntil: 'domcontentloaded' });
    let document = await this.parsers.pages.parse(page);

    if (reference.cityId !== null && !(await this.isInCity(context, reference.cityId))) {
      if (!(await this.setCity(page, reference.cityId))) {
        this.logger.warn(`The city ${reference.cityId} could not be chosen on the site`);

        return { status: 'parse_error' };
      }

      await page.reload({ waitUntil: 'domcontentloaded' });
      document = await this.parsers.pages.parse(page);
    }

    return this.resultOf(reference, document, lastResponse(), exitIp);
  }

  private resultOf(
    reference: ProductReferenceEntity,
    document: DnsPageInterface,
    response: Response | null,
    exitIp: string | null,
  ): ReadProductResultType {
    if (response === null) return { status: 'network_error' };
    if (!response.ok()) {
      this.logger.warn(`HTTP ${String(response.status())} instead of the product page`);

      return { status: 'http_error', httpStatus: response.status() };
    }

    const snapshot = this.parsers.products.parse(reference, document);
    if (snapshot === null) {
      this.logger.warn('The product card could not be parsed');

      return { status: 'parse_error' };
    }

    this.logger.debug(
      `Parsed "${snapshot.title.slice(0, 60)}": ${String(snapshot.prices.length)} prices, ${snapshot.availability}`,
    );

    return { status: 'success', snapshot, exitIp };
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

  private async isInCity(context: BrowserContext, cityId: string): Promise<boolean> {
    const cookie = (await context.cookies()).find(({ name }): boolean => name === 'current_path');

    return cookie !== undefined && this.parsers.cities.parse(cookie.value) === cityId;
  }

  /**
   * Does what the city selector of the site does: asks for the city, and the site answers with its id.
   * An answer that does not come within the time given is a failure, not a wait without end.
   */
  private setCity(page: Page, cityId: string): Promise<boolean> {
    return page.evaluate(
      async ({ id, timeoutMs }): Promise<boolean> => {
        const response = await fetch('/city-service/set-city/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cityId: id }),
          credentials: 'include',
          signal: AbortSignal.timeout(timeoutMs),
        });

        return response.ok && (await response.text()).replaceAll('"', '') === id;
      },
      { id: cityId, timeoutMs: this.timeoutMs },
    );
  }
}
