import { errorMessage, type LoggerPort, silentLogger } from 'logger';
import {
  marketplaceDefaultCities,
  type ProductReferenceEntity,
  type ResolveProductReferenceUseCase,
} from 'product-reference';

import { type ClockPort, systemClock } from '../../shared/application/clock.port.js';
import { enforceRateLimits } from '../../shared/application/enforce-rate-limits.type.js';
import type { RateLimiterPort } from '../../shared/application/rate-limiter.port.js';
import type { TrackedProductEntity } from '../domain/tracked-product.entity.js';
import { unchangedLinks } from './add-product-defaults.type.js';
import type { ExpandProductLinkUseCase } from './expand-product-link.use-case.js';
import type { KnownCityInterface, MarketplaceCitiesPort } from './marketplace-cities.port.js';
import type { PriceObservationRepositoryPort } from './price-observation-repository.port.js';
import { ProductAddingInProgressError } from './product-adding-in-progress.error.js';
import { ProductGoneError } from './product-gone.error.js';
import { ProductGroupFullError } from './product-group-full.error.js';
import { ProductGroupNotFoundError } from './product-group-not-found.error.js';
import type { ProductGroupRepositoryPort } from './product-group-repository.port.js';
import type { ProductLimitsInterface } from './product-quota.type.js';
import { ProductQuotaExceededError } from './product-quota-exceeded.error.js';
import type { RequestPriceObservationUseCase } from './request-price-observation.use-case.js';
import type {
  TrackedProductReferenceInterface,
  TrackedProductRepositoryPort,
} from './tracked-product-repository.port.js';
import { UnknownCityError } from './unknown-city.error.js';
import { UnsupportedProductUrlError } from './unsupported-product-url.error.js';

export interface AddedProductInterface {
  product: TrackedProductEntity;
  /** The group of the user the product is in: the one asked for, a new one when none was, or the one it was in already. */
  groupId: string;
  /** Whether the user tracks the product from now on, not whether it is new. */
  created: boolean;
  /** The job that reads the first price of a product that has none; null when there is nothing to read or no way to. */
  jobId: string | null;
}

/** A read of the first price queued this long ago is on its way still: another user adding the product does not queue it again. */
const firstReadPendingMs = 60_000;

/**
 * Starts tracking a product for a user by any link to it; the users share one product. A product that
 * has no price yet gets its first read queued when a user starts tracking it: there is no other way to ask for one, the refreshes
 * are for a schedule. A user is held to a number of products and to a rate of adding them.
 */
export class AddProductUseCase {
  constructor(
    private readonly resolveReference: ResolveProductReferenceUseCase,
    private readonly products: TrackedProductRepositoryPort,
    private readonly groups: ProductGroupRepositoryPort,
    private readonly observations: PriceObservationRepositoryPort,
    private readonly requestObservation: Pick<RequestPriceObservationUseCase, 'execute'>,
    private readonly limiter: RateLimiterPort,
    private readonly limits: ProductLimitsInterface,
    private readonly logger: LoggerPort = silentLogger,
    private readonly expandLink: Pick<ExpandProductLinkUseCase, 'execute'> = unchangedLinks,
    private readonly cities: MarketplaceCitiesPort = {
      find: (): Promise<KnownCityInterface | null> => Promise.resolve(null),
    },
    private readonly clock: ClockPort = systemClock,
  ) {}

  /** The adds in progress by user: a link can take minutes to expand, and a reload sends it again. */
  private readonly running = new Map<
    string,
    { key: string; result: Promise<AddedProductInterface> }
  >();

  /**
   * One product at a time per user. The same link while it is being added joins the add in progress
   * instead of starting another one, and is not counted against the rate limit again.
   */
  execute(
    userId: string,
    url: string,
    cityId: string | null = null,
    groupId: string | null = null,
  ): Promise<AddedProductInterface> {
    const key = `${url}\n${cityId ?? ''}\n${groupId ?? ''}`;
    const running = this.running.get(userId);
    if (running !== undefined) {
      return running.key === key
        ? running.result
        : Promise.reject(new ProductAddingInProgressError());
    }

    const result = this.add(userId, url, cityId, groupId).finally((): void => {
      this.running.delete(userId);
    });
    this.running.set(userId, { key, result });

    return result;
  }

  private async add(
    userId: string,
    url: string,
    askedCityId: string | null,
    askedGroupId: string | null,
  ): Promise<AddedProductInterface> {
    // Before the link is expanded: that takes a browser of the worker.
    await enforceRateLimits(this.limiter, [[`product-add:user:${userId}`, this.limits.add]]);
    if (askedGroupId !== null) await this.requireRoomInGroup(userId, askedGroupId);

    const productUrl = await this.expandLink.execute(url);

    let reference: ProductReferenceEntity;
    try {
      reference = this.resolveReference.execute(productUrl);
    } catch {
      throw new UnsupportedProductUrlError();
    }

    const city = await this.cityOf(reference, askedCityId);
    // The city may have had another id when the item was tracked in it: that product is the one.
    const trackedInCity =
      city === null || city.aliases.length === 0
        ? null
        : await this.products.findInCities(reference.marketplace, reference.id, [
            city.id,
            ...city.aliases,
          ]);

    const tracked = {
      marketplace: reference.marketplace,
      externalId: reference.id,
      url: reference.url,
      cityId: trackedInCity?.snapshot.cityId ?? city?.id ?? null,
      cityName: trackedInCity?.snapshot.cityName ?? city?.name ?? null,
    };

    // Before the product is created: a refused one would be left, tracked by nobody.
    const tracking = await this.products.listSubscribed(userId, { page: 1, pageSize: 1 });
    if (tracking.total >= this.limits.maxProducts) {
      // A full quota refuses a new product, not one the user tracks already.
      const own = await this.products.findSubscribedByReference(userId, tracked);
      if (own !== null) {
        return {
          product: own,
          created: false,
          jobId: null,
          groupId: await this.place(userId, own.snapshot.id, askedGroupId),
        };
      }

      throw new ProductQuotaExceededError(this.limits.maxProducts);
    }

    let added: { product: TrackedProductEntity; created: boolean };
    try {
      added = await this.track(userId, tracked);
    } catch (error: unknown) {
      // The last tracker removed the product between the add and the subscribe: add it anew, once.
      if (!(error instanceof ProductGoneError)) throw error;

      added = await this.track(userId, tracked);
    }

    const placedGroupId = await this.place(userId, added.product.snapshot.id, askedGroupId);

    // Only a user who joins reads: adding a product again must not queue a job again.
    const jobId = added.created
      ? await this.readFirstPrice(userId, added.product.snapshot.id)
      : null;

    return { ...added, jobId, groupId: placedGroupId };
  }

  /** The group is the user's and has room for one more product. */
  private async requireRoomInGroup(userId: string, groupId: string): Promise<void> {
    if ((await this.groups.findOwned(userId, groupId)) === null) {
      throw new ProductGroupNotFoundError(groupId);
    }

    const held = (await this.groups.listProductIds([groupId])).length;
    if (held >= this.limits.maxProductsPerGroup) {
      throw new ProductGroupFullError(this.limits.maxProductsPerGroup);
    }
  }

  /** The product goes into the group asked for, else into a new one; a product that is in a group of the user stays in it. */
  private async place(
    userId: string,
    productId: string,
    askedGroupId: string | null,
  ): Promise<string> {
    const placed = await this.groups.findGroupIdOfProduct(userId, productId);
    if (placed !== null) return placed;

    const groupId = askedGroupId ?? (await this.groups.create(userId, null)).snapshot.id;
    await this.groups.place(userId, groupId, productId);

    return groupId;
  }

  /**
   * A marketplace with cities has the city asked for if it knows it, else its default one; one without has none.
   * The city is the one of the handbook, by whichever of its ids is asked for; the default one is known before
   * the handbook is read.
   */
  private async cityOf(
    reference: ProductReferenceEntity,
    askedCityId: string | null,
  ): Promise<KnownCityInterface | null> {
    const defaultCity = marketplaceDefaultCities[reference.marketplace];
    if (defaultCity === undefined) return null;

    const cityId = askedCityId ?? defaultCity.id;
    const found = await this.cities.find(reference.marketplace, cityId);
    if (found !== null) return found;
    if (cityId === defaultCity.id) return { ...defaultCity, aliases: [] };

    throw new UnknownCityError(cityId);
  }

  private async track(
    userId: string,
    reference: TrackedProductReferenceInterface,
  ): Promise<{ product: TrackedProductEntity; created: boolean }> {
    const added = await this.products.add(reference);
    if (added.created)
      this.logger.info(
        `Tracking ${reference.marketplace} ${reference.externalId} as product ${added.product.snapshot.id}: ${reference.url}`,
      );

    const created = await this.products.subscribe(userId, added.product.snapshot.id);

    return { product: added.product, created };
  }

  /** The product is tracked whether or not its price can be read now: no proxy, or a queue that is down, is no reason to refuse it. */
  private async readFirstPrice(userId: string, productId: string): Promise<string | null> {
    if ((await this.observations.findLatestByProducts([productId])).length > 0) return null;
    if (await this.isBeingRead(productId)) return null;

    try {
      return (await this.requestObservation.execute(userId, productId)).jobId;
    } catch (error: unknown) {
      this.logger.warn(
        `The first price of product ${productId} is not queued: ${errorMessage(error)}`,
      );

      return null;
    }
  }

  /** Another user added the product a moment ago, and the read of its first price is on its way. */
  private async isBeingRead(productId: string): Promise<boolean> {
    const requestedAt = (await this.products.findById(productId))?.snapshot.lastRequestedAt;

    return (
      requestedAt !== null &&
      requestedAt !== undefined &&
      this.clock.now().getTime() - requestedAt.getTime() < firstReadPendingMs
    );
  }
}
