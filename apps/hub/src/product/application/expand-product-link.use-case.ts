import { type LoggerPort, silentLogger } from 'logger';
import type { OzonShortLinkParser } from 'product-reference';

import { NoProxiesAvailableError } from '../../shared/application/no-proxies-available.error.js';
import type { ChoosePriceRoutesUseCase } from './choose-price-routes.use-case.js';
import type { ProductLinkExpanderPort } from './product-link-expander.port.js';
import { UnsupportedProductUrlError } from './unsupported-product-url.error.js';

/** A person waits for the answer: a few routes, each for a short while, not all of them for as long as a price read. */
const maxRoutes = 3;

/** Turns a short link of a marketplace into the address of its product; any other link is left as it is. */
export class ExpandProductLinkUseCase {
  constructor(
    private readonly shortLinks: OzonShortLinkParser,
    private readonly chooseRoutes: Pick<ChoosePriceRoutesUseCase, 'execute'>,
    private readonly expander: ProductLinkExpanderPort,
    private readonly routeTimeoutMs: number,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  async execute(url: string): Promise<string> {
    if (!this.isShortLink(url)) return url;

    const chosen = await this.chooseRoutes.execute('ozon');
    const direct = chosen.filter(({ server }): boolean => server === null);
    const proxies = chosen.filter(({ server }): boolean => server !== null);
    const routes = [...proxies.slice(0, maxRoutes - direct.length), ...direct];
    if (routes.length === 0) throw new NoProxiesAvailableError();

    try {
      return await this.expander.expand({ url, routes, timeoutMs: this.routeTimeoutMs });
    } catch (error: unknown) {
      this.logger.warn(`A short link was not expanded: ${String(error)}`);

      throw new UnsupportedProductUrlError();
    }
  }

  private isShortLink(url: string): boolean {
    try {
      return this.shortLinks.isShortLink(new URL(url));
    } catch {
      return false;
    }
  }
}
