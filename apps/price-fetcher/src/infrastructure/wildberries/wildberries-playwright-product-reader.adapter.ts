import type { CamoufoxOptionsFactory } from 'camoufox-options';
import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { Browser, BrowserContext, Page, Response } from 'playwright-core';
import { marketplaceExitCountries, type ProductReferenceEntity } from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ProductBatchReaderPort } from '../../application/product/product-batch-reader.port.js';
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

/** The answers that refuse the address of the route, or come from the proxy itself, rather than from the product. */
const routeRefusalHttpStatuses: readonly number[] = [401, 403, 407, 429];

/** How many product pages one visit opens at most: a page is opened again only for products its card left out. */
const pagesPerVisit = 3;

/** What a product page gave: the route failed for every product, or a result for the products it told of. */
type PageOutcomeType =
  | { failure: ReadProductResultType }
  | { results: Map<ProductReferenceEntity, ReadProductResultType> };

/** The products the page asks the card service about, besides those it asks for by itself. */
interface CardAskInterface {
  opened: string;
  numbers: readonly string[];
}

/**
 * Reads Wildberries products from the answer of the card service to a product page. The page asks the service for
 * the products of one city at once: the numbers of the other products of the batch go into the request of the page
 * about its own product, so one page gives the prices of all of them.
 */
export class WildberriesPlaywrightProductReaderAdapter
  implements ProductReaderPort, ProductBatchReaderPort
{
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
    const [result] = await this.readMany([reference], proxy, signal);

    return result ?? { status: 'parse_error' };
  }

  /** The references are of one city: the page asks the card service in the region of the first. */
  async readMany(
    references: readonly ProductReferenceEntity[],
    proxy: ProxyEndpointEntity,
    signal: AbortSignal,
  ): Promise<ReadProductResultType[]> {
    signal.throwIfAborted();
    if (references.length === 0) return [];

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
      return await this.readPages(references, proxy, context);
    } catch (error: unknown) {
      signal.throwIfAborted();
      this.logger.warn(`Browser error via ${route}: ${errorMessage(error).split('\n')[0] ?? ''}`);

      return references.map((): ReadProductResultType => ({ status: 'network_error' }));
    } finally {
      signal.removeEventListener('abort', abort);
      await context.close();
    }
  }

  private async readPages(
    references: readonly ProductReferenceEntity[],
    proxy: ProxyEndpointEntity,
    context: BrowserContext,
  ): Promise<ReadProductResultType[]> {
    const page = await context.newPage();
    const [first] = references;
    const country = marketplaceExitCountries.wildberries;
    const exit = await this.exits.check(proxy, country, () => this.parsers.geoIp.parse(page));
    if (exit.status !== 'confirmed') {
      this.logger.warn(
        exit.status === 'unavailable'
          ? `GeoIP gave no answer through ${proxy.server}`
          : `GeoIP did not confirm an exit in ${country} through ${proxy.server}`,
      );
      const failure: ReadProductResultType = {
        status: exit.status === 'unavailable' ? 'network_error' : 'proxy_rejected',
        stage: 'exit',
      };

      return references.map((): ReadProductResultType => failure);
    }

    const exitIp = exit.exitIp;
    this.logger.debug(`Exit IP through ${proxy.server} is ${exitIp} (${country})`);

    const ask: CardAskInterface = { opened: '', numbers: [] };
    await this.askAbout(page, first?.cityId ?? null, ask);
    const lastResponse = this.watch(page);

    const results = new Map<ProductReferenceEntity, ReadProductResultType>();
    let unread = [...references];
    for (let opened = 0; opened < pagesPerVisit; opened += 1) {
      const [reference] = unread;
      if (reference === undefined) break;

      ask.opened = reference.id;
      ask.numbers = unread.map(({ id }): string => id);
      const outcome = await this.readPage(page, reference, unread, lastResponse, exitIp, proxy);
      if ('failure' in outcome) {
        // The route does not let the page through: the others are not read through it either.
        for (const other of unread) results.set(other, outcome.failure);

        break;
      }

      for (const [read, result] of outcome.results) results.set(read, result);
      unread = unread.filter((other): boolean => !results.has(other));
    }

    return references.map(
      (reference): ReadProductResultType => results.get(reference) ?? { status: 'parse_error' },
    );
  }

  /** Opens the page of a product and reads from the card the products asked for that it tells of. */
  private async readPage(
    page: Page,
    opened: ProductReferenceEntity,
    wanted: readonly ProductReferenceEntity[],
    lastResponse: () => Response | null,
    exitIp: string,
    proxy: ProxyEndpointEntity,
  ): Promise<PageOutcomeType> {
    const card = this.watchCard(page, opened);
    await page.goto(opened.url, { waitUntil: 'domcontentloaded' });
    const document = await this.parsers.pages.parse(page, card);
    const response = lastResponse();
    if (response === null) return { failure: { status: 'network_error' } };
    if (this.parsers.challenges.isChallenge(response.status())) {
      this.logger.warn(`The site check was not passed via ${proxy.server}`);

      return { failure: { status: 'challenge_required' } };
    }
    if (!response.ok()) {
      this.logger.warn(`HTTP ${String(response.status())} instead of the product page`);
      const failure: ReadProductResultType = {
        status: 'http_error',
        httpStatus: response.status(),
      };

      // A page that is gone is of its product alone.
      return routeRefusalHttpStatuses.includes(response.status())
        ? { failure }
        : { results: new Map([[opened, failure]]) };
    }

    const results = new Map<ProductReferenceEntity, ReadProductResultType>();
    for (const reference of wanted) {
      const snapshot = this.parsers.products.parse(reference, document, opened);
      if (snapshot !== null) {
        this.logger.debug(
          `Parsed "${snapshot.title.slice(0, 60)}": ${String(snapshot.prices.length)} prices, ${snapshot.availability}`,
        );
        results.set(reference, {
          // A card without a price is read too: the product may be out of stock.
          status: snapshot.prices.length > 0 ? 'success' : 'partial',
          snapshot,
          exitIp,
        });
      } else if (reference === opened) {
        this.logger.warn(
          document.card === ''
            ? 'The card service did not answer the page'
            : 'The product card could not be parsed',
        );
        results.set(reference, { status: 'parse_error' });
      }
    }

    return { results };
  }

  /**
   * The page asks the card service for the prices in the region of the address its visitor chose: the region of
   * the city asked for goes in its place, the prices are the same for all the regions of a city. Its request about
   * the product it shows asks about the other products of the batch too.
   */
  private async askAbout(page: Page, cityId: string | null, ask: CardAskInterface): Promise<void> {
    await page.route(
      (url): boolean => cardPath.test(url.pathname),
      async (route): Promise<void> => {
        const url = new URL(route.request().url());
        if (cityId !== null) url.searchParams.set('dest', cityId);

        const numbers = (url.searchParams.get('nm') ?? '').split(';');
        if (numbers.includes(ask.opened)) {
          url.searchParams.set('nm', Array.from(new Set([...numbers, ...ask.numbers])).join(';'));
        }
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
