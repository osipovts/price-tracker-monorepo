import type { MarketplaceReferenceParserPort, ProductReferenceEntity } from 'product-reference';
import { z } from 'zod';

import type {
  PriceObservationInterface,
  ProductSnapshotInterface,
} from '../../domain/product/product-snapshot.interface.js';
import type { AptekaPageInterface } from './apteka-page.interface.js';

const typedPriceSchema = z.object({
  dbPrice: z.number().optional(),
});
const itemInfoSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1),
  price: z.number().optional(),
  outOfStock: z.boolean().optional(),
  typedPrices: z.array(typedPriceSchema).nullish(),
  mediaWithUids: z.array(z.object({ photoUrl: z.string().nullish() })).nullish(),
  photoPack: z
    .object({
      photos: z.array(z.object({ original: z.string().nullish() })).nullish(),
    })
    .nullish(),
});
const stateSchema = z.object({
  product: z.object({
    error: z.boolean().optional(),
    groupItems: z
      .array(
        z.object({
          itemInfos: z.array(z.unknown()).nullish(),
        }),
      )
      .nullish(),
  }),
});

type AptekaItemType = z.infer<typeof itemInfoSchema>;

function httpsUrlOf(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null;

  const url = URL.parse(value);

  return url?.protocol === 'https:' ? url.href : null;
}

export class AptekaProductParser {
  constructor(private readonly references: MarketplaceReferenceParserPort) {}

  /** Returns null when the page has no valid `__INITIAL_STATE__` entry for the requested product. */
  parse(
    reference: ProductReferenceEntity,
    page: AptekaPageInterface,
  ): ProductSnapshotInterface | null {
    if (!this.isPageOf(reference, page.url)) return null;

    const item = this.readItem(reference.id, page.initialState);
    if (item === null) return null;

    const availability = this.readAvailability(item);
    const amountMinor = availability === 'out_of_stock' ? null : this.readItemAmountMinor(item);
    const prices: PriceObservationInterface[] =
      amountMinor === null ? [] : [{ amountMinor, currency: 'RUB' }];

    return {
      title: item.name,
      observedAt: new Date().toISOString(),
      prices,
      availability,
      imageUrl: this.readImageUrl(item),
    };
  }

  private readItem(id: string, rawState: string): AptekaItemType | null {
    if (rawState === '') return null;

    try {
      const parsed = stateSchema.safeParse(JSON.parse(rawState));
      if (!parsed.success || parsed.data.product.error === true) return null;

      for (const group of parsed.data.product.groupItems ?? []) {
        for (const rawItem of group.itemInfos ?? []) {
          const candidate = itemInfoSchema.safeParse(rawItem);
          if (candidate.success && candidate.data.id.toLowerCase() === id) return candidate.data;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private readAvailability(item: AptekaItemType): ProductSnapshotInterface['availability'] {
    if (item.outOfStock === true) return 'out_of_stock';
    if (item.outOfStock === false) return 'in_stock';

    return 'unknown';
  }

  private readItemAmountMinor(item: AptekaItemType): number | null {
    const direct = this.readAmountMinor(item.price);
    if (direct !== null) return direct;

    const typed = (item.typedPrices ?? [])
      .map((entry): number | null => this.readAmountMinor(entry.dbPrice))
      .filter((amount): amount is number => amount !== null);

    return typed.length > 0 ? Math.min(...typed) : null;
  }

  private readAmountMinor(rubles: number | undefined): number | null {
    if (rubles === undefined || !Number.isFinite(rubles)) return null;

    const amountMinor = Math.round(rubles * 100);

    return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : null;
  }

  private readImageUrl(item: AptekaItemType): string | null {
    const mediaPath = item.mediaWithUids?.find(
      (entry): boolean =>
        entry.photoUrl !== undefined && entry.photoUrl !== null && entry.photoUrl !== '',
    )?.photoUrl;
    if (mediaPath !== undefined && mediaPath !== null && mediaPath !== '') {
      if (mediaPath.startsWith('https://')) return httpsUrlOf(mediaPath);
      if (/^[\w.-]+$/.test(mediaPath)) return `https://images.apteka.ru/original_${mediaPath}`;
    }

    return httpsUrlOf(item.photoPack?.photos?.[0]?.original);
  }

  private isPageOf(reference: ProductReferenceEntity, url: string): boolean {
    try {
      return this.references.parse(new URL(url))?.id === reference.id;
    } catch {
      return false;
    }
  }
}
