import type { CamoufoxOptionsFactory } from 'camoufox-options';
import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { Browser, BrowserContext, Page, Response } from 'playwright-core';
import {
  marketplaceDefaultCities,
  marketplaceExitCountries,
  ozonCities,
  type OzonCityInterface,
  type ProductReferenceEntity,
} from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ProductReaderPort } from '../../application/product/product-reader.port.js';
import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import type { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { ProxyExitChecker } from '../shared/proxy-exit.checker.js';
import type { OzonChallengeParser } from './ozon-challenge.parser.js';
import type { OzonPageParser } from './ozon-page.parser.js';
import type { OzonPickupPointParser } from './ozon-pickup-point.parser.js';
import type { OzonProductParser } from './ozon-product.parser.js';

export interface OzonReaderParsersInterface {
  geoIp: GeoIpPageParser;
  pages: OzonPageParser;
  challenges: OzonChallengeParser;
  products: OzonProductParser;
  pickupPoints: OzonPickupPointParser;
}

/** The address of the API of the pages of Ozon that opens a page of the delivery modal. */
function deliveryPageUrl(query: string): string {
  return `/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(`/modal/commonDelivery?${query}`)}`;
}

export class OzonPlaywrightProductReaderAdapter implements ProductReaderPort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly parsers: OzonReaderParsersInterface,
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
    this.logger.debug(`Exit IP through ${proxy.server} is ${exitIp} (${country})`);

    const lastResponse = await this.open(page, reference);
    if (this.isChallenge(await this.parsers.pages.parse(page), proxy)) {
      return { status: 'challenge_required' };
    }

    // Without a pickup point Ozon prices for the region of the address of the route.
    const city = this.cityOf(reference);
    if (city === undefined) {
      this.logger.warn(`The city ${reference.cityId ?? ''} is not one of the cities of Ozon`);

      return { status: 'parse_error' };
    }

    const chosen = await this.choosePickupPoint(page, city);
    if (chosen !== 'chosen') return { status: chosen };

    await page.reload({ waitUntil: 'domcontentloaded' });
    const document = await this.parsers.pages.parse(page);
    const response = lastResponse();
    if (this.isChallenge(document, proxy)) return { status: 'challenge_required' };

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

    return {
      // A card without a price is read too: the product may be out of stock.
      status: snapshot.prices.length > 0 ? 'success' : 'partial',
      snapshot,
      exitIp,
    };
  }

  private isChallenge(
    document: { title: string; body: string },
    proxy: ProxyEndpointEntity,
  ): boolean {
    const challenge = this.parsers.challenges.isChallenge(document.title, document.body);
    if (challenge) this.logger.warn(`The site check appeared via ${proxy.server}`);

    return challenge;
  }

  /** The city of the product, or the default one for a product tracked before Ozon had cities. */
  private cityOf(reference: ProductReferenceEntity): OzonCityInterface | undefined {
    const cityId = reference.cityId ?? marketplaceDefaultCities.ozon?.id;

    return ozonCities.find((city): boolean => city.id === cityId);
  }

  /**
   * Does what the map of the delivery modal does: asks for the pickup points at the middle of the city, and
   * chooses the first of them for the session. A city without one is no city to read the price in.
   */
  private async choosePickupPoint(
    page: Page,
    city: OzonCityInterface,
  ): Promise<'chosen' | 'network_error' | 'parse_error'> {
    const near = await this.postDeliveryPage(
      page,
      `available=t&lat=${String(city.latitude)}&long=${String(city.longitude)}&pid=3&tab=pp`,
    );
    if (near.status !== 200) {
      this.logger.warn(`The pickup points of ${city.name} answered ${String(near.status)}`);

      return 'network_error';
    }

    const point = this.parsers.pickupPoints.parse(near.body);
    if (point === null) {
      this.logger.warn(`Ozon has no pickup point in ${city.name}`);

      return 'parse_error';
    }

    const choice = await this.postDeliveryPage(page, `pid=7&pp=${point}&tab=pp`);
    if (choice.status !== 200) {
      this.logger.warn(`The choice of the pickup point ${point} answered ${String(choice.status)}`);

      return 'network_error';
    }

    this.logger.debug(`Chose the pickup point ${point} of ${city.name}`);

    return 'chosen';
  }

  /** An answer that does not come within the time given is a failure, not a wait without end. */
  private postDeliveryPage(page: Page, query: string): Promise<{ status: number; body: string }> {
    return page.evaluate(
      async ({ target, timeoutMs }): Promise<{ status: number; body: string }> => {
        const response = await fetch(target, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(timeoutMs),
        });

        return { status: response.status, body: await response.text() };
      },
      { target: deliveryPageUrl(query), timeoutMs: this.timeoutMs },
    );
  }

  /**
   * Opens the product page. The result gives the response of the last main-frame navigation
   * at the time it is called: a challenge may redirect after the page has loaded.
   */
  private async open(
    page: Page,
    reference: ProductReferenceEntity,
  ): Promise<() => Response | null> {
    let response: Response | null = null;
    page.on('response', (received): void => {
      if (received.request().isNavigationRequest() && received.frame() === page.mainFrame())
        response = received;
    });

    response = await page.goto(reference.url, { waitUntil: 'domcontentloaded' });
    this.logger.debug(
      `Opened ${reference.url}: HTTP ${String(response?.status() ?? 'none')}, final URL ${page.url()}`,
    );

    return (): Response | null => response;
  }
}
