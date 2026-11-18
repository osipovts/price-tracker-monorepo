import { type LoggerPort, silentLogger } from 'logger';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { CityInterface } from '../domain/city.interface.js';
import type { CitySourcePort } from './city-source.port.js';

export interface FetchCitiesListenerInterface {
  /** Called with how many letters are done of all, first before the first one. */
  onProgress(done: number, total: number): Promise<void>;
}

/** Reads the cities of a marketplace letter by letter, and gives them by name. */
export class FetchCitiesUseCase {
  constructor(
    private readonly source: CitySourcePort,
    private readonly letters: readonly string[],
    private readonly logger: LoggerPort = silentLogger,
  ) {}

  /**
   * A route is opened once and reads the letters one after another; one that fails leaves the letter to
   * the next, which goes on from it. A letter that no route can read fails the whole read: part of the
   * cities would pass for all.
   */
  async execute(
    routes: ReadonlyArray<ProxyEndpointEntity | null>,
    signal: AbortSignal,
    listener: FetchCitiesListenerInterface,
  ): Promise<CityInterface[]> {
    if (routes.length === 0) throw new Error('No route to read the cities through');

    const cities = new Map<string, CityInterface>();
    let done = 0;
    await listener.onProgress(0, this.letters.length);

    for (const route of routes) {
      if (done === this.letters.length) break;

      signal.throwIfAborted();
      done = await this.readFrom(route, done, signal, cities, listener);
    }

    const letter = this.letters[done];
    if (letter !== undefined)
      throw new Error(`No route could read the cities of the letter ${letter}`);

    this.logger.info(`Read ${String(cities.size)} cities`);

    return Array.from(cities.values()).toSorted((a, b): number =>
      a.name.localeCompare(b.name, 'ru'),
    );
  }

  /** Returns how many letters are done once the route reads no more: all of them, or up to the one it failed at. */
  private async readFrom(
    route: ProxyEndpointEntity | null,
    done: number,
    signal: AbortSignal,
    cities: Map<string, CityInterface>,
    listener: FetchCitiesListenerInterface,
  ): Promise<number> {
    const name = route?.server ?? 'direct connection';
    let session;
    try {
      session = await this.source.open(route, signal);
    } catch {
      signal.throwIfAborted();
      this.logger.warn(`The marketplace did not open via ${name}`);

      return done;
    }

    let read = done;
    try {
      for (const letter of this.letters.slice(done)) {
        for (const city of await session.read(letter, signal)) cities.set(city.id, city);

        read += 1;
        await listener.onProgress(read, this.letters.length);
      }
    } catch {
      signal.throwIfAborted();
      this.logger.warn(`The letter ${this.letters[read] ?? '?'} was not read via ${name}`);
    } finally {
      await session.close();
    }

    return read;
  }
}
