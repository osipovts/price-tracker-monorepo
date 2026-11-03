import { randomUUID } from 'node:crypto';

import type { MarketplaceType } from 'product-reference';

import {
  type PageInterface,
  pageOf,
  type PaginationInterface,
} from '../../shared/application/page.interface.js';
import type {
  TrackedProductReferenceInterface,
  TrackedProductRepositoryPort,
} from '../application/tracked-product-repository.port.js';
import { TrackedProductEntity } from '../domain/tracked-product.entity.js';

function keyOf(reference: TrackedProductReferenceInterface): string {
  return `${reference.marketplace}/${reference.externalId}/${reference.cityId ?? ''}`;
}

export class InMemoryTrackedProductRepositoryAdapter implements TrackedProductRepositoryPort {
  private readonly products = new Map<string, TrackedProductEntity>();
  private readonly requested = new Map<string, Date>();
  /** In the order of subscribing: the newest subscription is the last one. */
  private readonly subscriptions: Array<{ userId: string; productId: string }> = [];

  add(
    reference: TrackedProductReferenceInterface,
  ): Promise<{ product: TrackedProductEntity; created: boolean }> {
    const existing = Array.from(this.products.values()).find(
      (product): boolean => keyOf(product.snapshot) === keyOf(reference),
    );
    if (existing !== undefined) return Promise.resolve({ product: existing, created: false });

    const product = new TrackedProductEntity({
      id: randomUUID(),
      ...reference,
      lastStatus: null,
      lastCheckedAt: null,
      lastRequestedAt: null,
      thumbnailKey: null,
      thumbnailSourceUrl: null,
    });
    this.products.set(product.snapshot.id, product);

    return Promise.resolve({ product, created: true });
  }

  subscribe(userId: string, productId: string): Promise<boolean> {
    const subscribed = this.subscribed(userId, productId);
    if (!subscribed) this.subscriptions.push({ userId, productId });

    return Promise.resolve(!subscribed);
  }

  unsubscribe(userId: string, productId: string): Promise<boolean> {
    const index = this.subscriptions.findIndex(
      (subscription): boolean =>
        subscription.userId === userId && subscription.productId === productId,
    );
    if (index === -1) return Promise.resolve(false);

    this.subscriptions.splice(index, 1);
    if (!this.subscriptions.some((subscription): boolean => subscription.productId === productId)) {
      this.products.delete(productId);
    }

    return Promise.resolve(true);
  }

  findInCities(
    marketplace: MarketplaceType,
    externalId: string,
    cityIds: readonly string[],
  ): Promise<TrackedProductEntity | null> {
    // The products are kept in the order they were added.
    const product = Array.from(this.products.values()).find(
      ({ snapshot }): boolean =>
        snapshot.marketplace === marketplace &&
        snapshot.externalId === externalId &&
        snapshot.cityId !== null &&
        cityIds.includes(snapshot.cityId),
    );

    return Promise.resolve(product ?? null);
  }

  findSubscribedByReference(
    userId: string,
    reference: TrackedProductReferenceInterface,
  ): Promise<TrackedProductEntity | null> {
    const product = Array.from(this.products.values()).find(
      (candidate): boolean => keyOf(candidate.snapshot) === keyOf(reference),
    );

    return Promise.resolve(
      product !== undefined && this.subscribed(userId, product.snapshot.id) ? product : null,
    );
  }

  listDueForRefresh(before: Date, limit: number): Promise<TrackedProductEntity[]> {
    const lastTouch = (product: TrackedProductEntity): number =>
      Math.max(
        product.snapshot.lastCheckedAt?.getTime() ?? 0,
        this.requested.get(product.snapshot.id)?.getTime() ?? 0,
      );
    const due = Array.from(this.products.values())
      .filter(
        (product): boolean =>
          this.subscriptions.some(({ productId }): boolean => productId === product.snapshot.id) &&
          lastTouch(product) < before.getTime(),
      )
      .toSorted((a, b): number => lastTouch(a) - lastTouch(b))
      .slice(0, limit);

    return Promise.resolve(due);
  }

  setThumbnail(id: string, key: string, sourceUrl: string): Promise<void> {
    const product = this.products.get(id);
    if (product !== undefined) {
      this.products.set(
        id,
        new TrackedProductEntity({
          ...product.snapshot,
          thumbnailKey: key,
          thumbnailSourceUrl: sourceUrl,
        }),
      );
    }

    return Promise.resolve();
  }

  markRequested(productIds: string[], at: Date): Promise<void> {
    for (const id of productIds) {
      this.requested.set(id, at);
      const product = this.products.get(id);
      if (product !== undefined)
        this.products.set(
          id,
          new TrackedProductEntity({ ...product.snapshot, lastRequestedAt: at }),
        );
    }

    return Promise.resolve();
  }

  stats(): Promise<{ products: number; trackings: number }> {
    return Promise.resolve({ products: this.products.size, trackings: this.subscriptions.length });
  }

  findSubscribed(userId: string, productId: string): Promise<TrackedProductEntity | null> {
    return Promise.resolve(
      this.subscribed(userId, productId) ? (this.products.get(productId) ?? null) : null,
    );
  }

  listSubscribed(
    userId: string,
    pagination: PaginationInterface,
  ): Promise<PageInterface<TrackedProductEntity>> {
    const own = this.subscriptions
      .filter((subscription): boolean => subscription.userId === userId)
      .flatMap(({ productId }): TrackedProductEntity[] => {
        const product = this.products.get(productId);

        return product === undefined ? [] : [product];
      });

    return Promise.resolve(pageOf(own.toReversed(), pagination));
  }

  findById(id: string): Promise<TrackedProductEntity | null> {
    return Promise.resolve(this.products.get(id) ?? null);
  }

  private subscribed(userId: string, productId: string): boolean {
    return this.subscriptions.some(
      (subscription): boolean =>
        subscription.userId === userId && subscription.productId === productId,
    );
  }

  markChecked(id: string, status: string, checkedAt: Date): Promise<void> {
    const product = this.products.get(id);
    if (product !== undefined)
      this.products.set(
        id,
        new TrackedProductEntity({
          ...product.snapshot,
          lastStatus: status,
          lastCheckedAt: checkedAt,
        }),
      );

    return Promise.resolve();
  }
}
