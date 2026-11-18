import { setTimeout } from 'node:timers/promises';

import { type LoggerPort, silentLogger } from 'logger';
import type { OzonShortLinkParser, ResolveProductReferenceUseCase } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import type { LinkExpanderPort } from './link-expander.port.js';

export interface ExpandLinkJobInterface {
  url: string;
  /** Routes in the order they are tried; a null server is a direct connection. */
  routes: ReadonlyArray<{ server: string | null }>;
  timeoutMs: number;
}

/** Finds out which product a short link leads to; the answer is the canonical address of the product. */
export class ExpandLinkUseCase {
  constructor(
    private readonly shortLinks: OzonShortLinkParser,
    private readonly resolveReference: ResolveProductReferenceUseCase,
    private readonly createExpander: (timeoutMs: number) => LinkExpanderPort,
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  async execute(job: ExpandLinkJobInterface, signal: AbortSignal): Promise<string> {
    const url = new URL(job.url);
    if (!this.shortLinks.isShortLink(url)) throw new Error('Not a short link');

    const candidates: Array<ProxyEndpointEntity | null> = [];
    for (const route of job.routes) {
      try {
        candidates.push(route.server === null ? null : new ProxyEndpointEntity(route.server));
      } catch {
        this.logger.warn('Skipping a route with an unsafe or unsupported proxy address');
      }
    }

    const expander = this.createExpander(job.timeoutMs);
    let attempts = 0;

    for (const proxy of candidates) {
      signal.throwIfAborted();
      if (attempts > 0) await setTimeout(1000, undefined, { signal });
      attempts += 1;

      const target = await expander.expand(url, proxy, signal);
      const product = target === null ? null : this.productUrlOf(target);
      this.logger.verbose(
        `Attempt ${String(attempts)} via ${proxy?.server ?? 'direct connection'}: ${product ?? 'no product'}`,
      );
      if (product !== null) return product;
    }

    throw new Error(`The short link led to no product after ${String(attempts)} attempts`);
  }

  private productUrlOf(url: string): string | null {
    try {
      return this.resolveReference.execute(url).url;
    } catch {
      return null;
    }
  }
}
