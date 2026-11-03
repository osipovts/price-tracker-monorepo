import type { CamoufoxOptionsFactory } from 'camoufox-options';
import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { Browser, BrowserContext, Page, Response } from 'playwright-core';
import { marketplaceExitCountries, type ProductReferenceEntity } from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ProductReaderPort } from '../../application/product/product-reader.port.js';
import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import type { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { ProxyExitChecker } from '../shared/proxy-exit.checker.js';
import type { WildberriesChallengeParser } from './wildberries-challenge.parser.js';
import type { WildberriesPageParser } from './wildberries-page.parser.js';
import type { WildberriesProductParser } from './wildberries-product.parser.js';

export interface WildberriesReaderParsersInterface {
  geoIp: GeoIpPageParser;
  pages: WildberriesPageParser;
  challenges: WildberriesChallengeParser;
  products: WildberriesProductParser;
}

/** The path of the card service the page asks for the prices and stocks of the products it shows. */
const cardPath = /\/cards\/v\d+\/detail$/;

export class WildberriesPlaywrightProductReaderAdapter implements ProductReaderPort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly parsers: WildberriesReaderParsersInterface,
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

    if (reference.cityId !== null) await this.askInCity(page, reference.cityId);

    const card = this.watchCard(page, reference);
    const lastResponse = this.watch(page);
    await page.goto(reference.url, { waitUntil: 'domcontentloaded' });
    const document = await this.parsers.pages.parse(page, card);
    const response = lastResponse();
    if (response === null) return { status: 'network_error' };
    if (this.parsers.challenges.isChallenge(response.status())) {
      this.logger.warn(`The site check was not passed via ${proxy.server}`);

      return { status: 'challenge_required' };
    }
    if (!response.ok()) {
      this.logger.warn(`HTTP ${String(response.status())} instead of the product page`);

      return { status: 'http_error', httpStatus: response.status() };
    }

    const snapshot = this.parsers.products.parse(reference, document);
    if (snapshot === null) {
      this.logger.warn(
        document.card === ''
          ? 'The card service did not answer the page'
          : 'The product card could not be parsed',
      );

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

  /**
   * The page asks the card service for the prices in the region of the address its visitor chose: the region
   * of the city asked for goes in its place. The prices are the same for all the regions of a city.
   */
  private async askInCity(page: Page, cityId: string): Promise<void> {
    await page.route(
      (url): boolean => cardPath.test(url.pathname),
      async (route): Promise<void> => {
        const url = new URL(route.request().url());
        url.searchParams.set('dest', cityId);
        await route.fallback({ url: url.href });
      },
    );
  }

  /**
   * The answer of the card service to the page about the product, as text; empty when the page did not ask
   * within the time given. The page asks it for other products too, by other numbers.
   */
  private async watchCard(page: Page, reference: ProductReferenceEntity): Promise<string> {
    try {
      const response = await page.waitForResponse((received): boolean => {
        const url = new URL(received.url());

        return (
          cardPath.test(url.pathname) &&
          (url.searchParams.get('nm') ?? '').split(';').includes(reference.id)
        );
      });

      return response.ok() ? await response.text() : '';
    } catch {
      return '';
    }
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
