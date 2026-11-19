import type { CamoufoxOptionsFactory } from 'camoufox-options';
import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { Browser, BrowserContext, Page, Response } from 'playwright-core';
import {
  AliexpressReferenceParser,
  marketplaceDefaultCities,
  marketplaceExitCountries,
  type ProductReferenceEntity,
} from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ProductReaderPort } from '../../application/product/product-reader.port.js';
import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import type { GeoIpPageParser } from '../shared/geo-ip-page.parser.js';
import { ProxyExitChecker } from '../shared/proxy-exit.checker.js';
import type { AliexpressPageParser } from './aliexpress-page.parser.js';
import type { AliexpressProductParser } from './aliexpress-product.parser.js';

export interface AliexpressReaderParsersInterface {
  geoIp: GeoIpPageParser;
  pages: AliexpressPageParser;
  products: AliexpressProductParser;
}

export class AliexpressPlaywrightProductReaderAdapter implements ProductReaderPort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly parsers: AliexpressReaderParsersInterface,
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

    const cityId = reference.cityId ?? marketplaceDefaultCities.aliexpress?.id ?? null;
    if (cityId !== null) await this.chooseCity(context, cityId);

    const lastResponse = this.watch(page);
    const productData = this.watchProductData(page, reference);
    await page.goto(reference.url, { waitUntil: 'commit' });

    const initialResponse = lastResponse();
    const route = proxy?.server ?? 'direct connection';
    if (initialResponse?.status() === 429) {
      this.logger.warn(`The antibot check was not passed via ${route}`);

      return { status: 'challenge_required' };
    }
    if (initialResponse !== null && !initialResponse.ok()) {
      this.logger.warn(`HTTP ${String(initialResponse.status())} instead of the product page`);

      return { status: 'http_error', httpStatus: initialResponse.status() };
    }

    const document = await this.parsers.pages.parse(page, productData);
    const response = lastResponse();
    if (document.hasChallenge || response?.status() === 429) {
      this.logger.warn(`The antibot check was not passed via ${route}`);

      return { status: 'challenge_required' };
    }
    if (response === null) return { status: 'network_error' };
    if (!response.ok()) {
      this.logger.warn(`HTTP ${String(response.status())} instead of the product page`);

      return { status: 'http_error', httpStatus: response.status() };
    }

    if (cityId !== null && document.cityId !== cityId) {
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

  /** Sets the city and Russian RUB locale in `aep_usuc_f` before opening the product page. */
  private chooseCity(context: BrowserContext, cityId: string): Promise<void> {
    const provinceId = /^\d{18}$/.test(cityId) ? `${cityId.slice(0, 8)}0000000000` : cityId;
    const value = `b_locale=ru_RU&c_tp=RUB&region=RU&site=rus&province=${provinceId}&city=${cityId}`;

    return context.addCookies([{ name: 'aep_usuc_f', value, domain: '.aliexpress.ru', path: '/' }]);
  }

  private watchProductData(page: Page, reference: ProductReferenceEntity): Promise<string> {
    return new Promise((resolve): void => {
      let settled = false;
      const timer = setTimeout((): void => {
        done('');
      }, this.timeoutMs);
      timer.unref();

      const done = (value: string): void => {
        if (settled) return;

        settled = true;
        clearTimeout(timer);
        page.off('response', onResponse);
        page.off('close', onClose);
        resolve(value);
      };
      const onClose = (): void => {
        done('');
      };
      const onResponse = (received: Response): void => {
        const url = URL.parse(received.url());
        if (url === null) return;

        if (
          received.request().isNavigationRequest() &&
          received.frame() === page.mainFrame() &&
          (received.status() >= 400 || url.pathname.includes('/_____tmd_____/punish'))
        ) {
          done('');

          return;
        }

        const { itemId } = AliexpressReferenceParser.splitId(reference.id);
        if (
          url.pathname === '/aer-jsonapi/v1/bx/pdp/web/productData' &&
          url.searchParams.get('productId') === itemId
        ) {
          void received
            .text()
            .then((text): void => {
              done(received.ok() ? text : '');
            })
            .catch((): void => {
              done('');
            });
        }
      };

      page.on('response', onResponse);
      page.once('close', onClose);
    });
  }

  /** The response of the last main-frame navigation at the time it is called. */
  private watch(page: Page): () => Response | null {
    let response: Response | null = null;
    page.on('response', (received): void => {
      if (received.request().isNavigationRequest() && received.frame() === page.mainFrame())
        response = received;
    });

    return (): Response | null => response;
  }
}
