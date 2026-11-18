import type { MarketplaceType } from 'product-reference';

export interface TrackedProductInterface {
  id: string;
  marketplace: MarketplaceType;
  externalId: string;
  /** Canonical product URL. */
  url: string;
  /** The city whose price is read, by the id of the marketplace; null where the marketplace has no cities. */
  cityId: string | null;
  /** The name of that city when the product was added. */
  cityName: string | null;
  /** Status of the last fetch, including failed ones. */
  lastStatus: string | null;
  lastCheckedAt: Date | null;
  /** When a read of the price was last queued, by a user or by the schedule. */
  lastRequestedAt: Date | null;
  /** The key of the picture of the product in the object storage; null until one is kept. */
  thumbnailKey: string | null;
  /** The address the kept picture was taken from. */
  thumbnailSourceUrl: string | null;
}

export class TrackedProductEntity {
  constructor(readonly snapshot: TrackedProductInterface) {}

  /** What a worker is asked to read: the page, and the city of a marketplace that has them. */
  get readRequest(): { trackedProductId: string; url: string; cityId?: string; cityName?: string } {
    const { id, url, marketplace, cityId, cityName } = this.snapshot;

    return {
      trackedProductId: id,
      url,
      ...(cityId === null ? {} : { cityId }),
      ...(marketplace === 'sportmaster' && cityName !== null ? { cityName } : {}),
    };
  }
}
