import type { CamoufoxOptionsFactory } from 'camoufox-options';
import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { ProxyEndpointEntity } from 'proxy-endpoint';
import { z } from 'zod';

import type {
  CitySourcePort,
  CitySourceSessionInterface,
} from '../application/city-source.port.js';
import type { CityInterface } from '../domain/city.interface.js';
import type {
  WildberriesPickupCitiesParser,
  WildberriesPickupPointInterface,
} from './wildberries-pickup-cities.parser.js';

const pointsSchema = z.array(z.object({ address: z.string(), dest: z.number().int() }));

/**
 * The site of Wildberries lists its pickup points in one file, and gives the prices of a product for the region
 * (`dest`) of the point chosen. The file is read the way the site reads it: in a browser, with a page of the site
 * open and its check passed. The towns are made of it once, and given by the first letter of the name.
 */
export class WildberriesBrowserCitySourceAdapter implements CitySourcePort {
  constructor(
    private readonly browser: Pick<Browser, 'newContext'>,
    private readonly options: CamoufoxOptionsFactory,
    private readonly parser: WildberriesPickupCitiesParser,
    private readonly timeoutMs: number,
    /** How long the file may take to come: it is tens of megabytes. */
    private readonly fileTimeoutMs: number,
    private readonly logger: LoggerPort = silentLogger,
    private readonly siteUrl = 'https://www.wildberries.ru/',
    private readonly pointsUrl = 'https://static-basket-01.wbbasket.ru/vol0/data/all-poo-fr-v12.json',
  ) {}

  async open(proxy: ProxyEndpointEntity, signal: AbortSignal): Promise<CitySourceSessionInterface> {
    signal.throwIfAborted();
    const context = await this.browser.newContext({
      ...this.options.context(proxy),
      acceptDownloads: false,
    });
    context.setDefaultTimeout(this.timeoutMs);
    context.setDefaultNavigationTimeout(this.timeoutMs);
    // A read that never gets its answer would hold the job: it ends with the time given, or with the job.
    const closeContext = (): void => {
      void context.close();
    };
    signal.addEventListener('abort', closeContext, { once: true });

    try {
      const page = await context.newPage();
      await page.goto(this.siteUrl, { waitUntil: 'domcontentloaded' });
      // The pages of the site have the address of delivery in their header; its check has none.
      await page
        .locator('[data-wba-header-name="DLV_Adress"]')
        .first()
        .waitFor({ state: 'attached' });
      this.logger.debug(`Opened ${this.siteUrl} via ${proxy.server}`);

      const cities = this.parser.parse(await this.readPoints(page));
      this.logger.debug(`Made ${String(cities.length)} towns of the pickup points`);

      return this.sessionOf(context, cities);
    } catch (error: unknown) {
      this.logger.debug(
        `Could not read the pickup points: ${errorMessage(error).split('\n')[0] ?? ''}`,
      );
      await context.close();
      throw error;
    } finally {
      signal.removeEventListener('abort', closeContext);
    }
  }

  /** The points of Russia: the file has those of the other countries the site delivers to as well. */
  private async readPoints(page: Page): Promise<WildberriesPickupPointInterface[]> {
    const answer = await page.evaluate(
      async ({ target, timeoutMs }): Promise<{ status: number; points: unknown }> => {
        const response = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) return { status: response.status, points: null };

        const groups: unknown = await response.json();
        // Only the address and the region of a point are taken: the whole of the file is too much to pass on.
        const points: Array<{ address: unknown; dest: unknown }> = [];
        const list: unknown[] = Array.isArray(groups) ? groups : [];
        for (const group of list) {
          if (
            typeof group !== 'object' ||
            group === null ||
            !('country' in group) ||
            group.country !== 'ru' ||
            !('items' in group) ||
            !Array.isArray(group.items)
          )
            continue;

          const items: unknown[] = group.items;
          for (const item of items) {
            if (typeof item === 'object' && item !== null && 'address' in item && 'dest' in item)
              points.push({ address: item.address, dest: item.dest });
          }
        }

        return { status: response.status, points };
      },
      { target: this.pointsUrl, timeoutMs: this.fileTimeoutMs },
    );
    if (answer.status !== 200) throw new Error(`The file answered ${String(answer.status)}`);

    return pointsSchema.parse(answer.points);
  }

  private sessionOf(
    context: BrowserContext,
    cities: readonly CityInterface[],
  ): CitySourceSessionInterface {
    return {
      read: (letter, signal): Promise<CityInterface[]> => {
        signal.throwIfAborted();

        return Promise.resolve(
          cities.filter((city): boolean => city.name.toLocaleUpperCase('ru').startsWith(letter)),
        );
      },
      close: async (): Promise<void> => {
        await context.close();
      },
    };
  }
}
