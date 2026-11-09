import type { ProxyEndpointEntity } from 'proxy-endpoint';

/** Tells cheaply, before a browser is opened, whether a route reaches a site at all. */
export interface RouteProbePort {
  /** False for a route that does not open a secure connection to the host in the time given. */
  reaches(proxy: ProxyEndpointEntity, host: string, signal: AbortSignal): Promise<boolean>;
}
