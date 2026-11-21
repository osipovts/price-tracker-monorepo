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
import type { AptekaPageParser } from './apteka-page.parser.js';
import type { AptekaProductParser } from './apteka-product.parser.js';

const citySlugPattern = /^[a-z0-9_-]+$/;

export interface AptekaReaderParsersInterface {
  geoIp: GeoIpPageParser;
  pages: AptekaPageParser;
  products: AptekaProductParser;
}

export class AptekaPlaywrightProductReaderAdapter implements ProductReaderPort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly parsers: AptekaReaderParsersInterface,
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

    const cityId = reference.cityId ?? marketplaceDefaultCities.apteka?.id ?? null;
    if (cityId === null || !citySlugPattern.test(cityId)) {
      this.logger.warn(`Invalid Apteka.ru city ${String(cityId)}`);

      return { status: 'parse_error' };
    }

    const navigation = this.watch(page);
    await page.goto(`https://apteka.ru/${cityId}/product/${reference.id}/`, {
      waitUntil: 'commit',
    });

    const document = await this.parsers.pages.parse(page, (): Promise<string> => navigation.body());
    if (document.hasChallenge) {
      this.logger.warn(
        `The Qrator check was not passed via ${proxy?.server ?? 'direct connection'}`,
      );

      return { status: 'challenge_required' };
    }

    const response = navigation.response();
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

  /** Tracks the last main-frame navigation response and its raw SSR body before redirects or hydration mutate it. */
  private watch(page: Page): { response: () => Response | null; body: () => Promise<string> } {
    let lastResponse: Response | null = null;
    let lastBody: Promise<string> = Promise.resolve('');
    page.on('response', (received): void => {
      if (!received.request().isNavigationRequest() || received.frame() !== page.mainFrame())
        return;

      lastResponse = received;
      if (received.status() < 300 || received.status() >= 400) {
        lastBody = received.text().catch((): string => '');
      }
    });

    return {
      response: (): Response | null => lastResponse,
      body: (): Promise<string> => lastBody,
    };
  }
}
