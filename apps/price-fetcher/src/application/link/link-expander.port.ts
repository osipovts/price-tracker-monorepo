import type { ProxyEndpointEntity } from 'proxy-endpoint';

export interface LinkExpanderPort {
  /** The address the short link leads to through the route; null when the route gives none. */
  expand(url: URL, proxy: ProxyEndpointEntity | null, signal: AbortSignal): Promise<string | null>;
}
