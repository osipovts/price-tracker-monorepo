import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { CityInterface } from '../domain/city.interface.js';

/** A route the marketplace was opened through: the cities are asked for letter by letter on it. */
export interface CitySourceSessionInterface {
  /** The cities whose names begin with the letter; rejects when the route stops working. */
  read(letter: string, signal: AbortSignal): Promise<CityInterface[]>;
  close(): Promise<void>;
}

export interface CitySourcePort {
  /** Opens the marketplace through the route; rejects when the route does not work. */
  open(proxy: ProxyEndpointEntity | null, signal: AbortSignal): Promise<CitySourceSessionInterface>;
}
