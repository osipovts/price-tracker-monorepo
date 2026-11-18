import type { MarketplaceReferenceParserPort, ProductReferenceEntity } from 'product-reference';
import { z } from 'zod';

import type {
  PriceObservationInterface,
  ProductSnapshotInterface,
} from '../../domain/product/product-snapshot.interface.js';
import type { SportmasterPageInterface } from './sportmaster-page.interface.js';

const offerSchema = z.object({
  price: z.union([z.string(), z.number()]).optional(),
  priceCurrency: z.literal('RUB'),
  availability: z.string().optional(),
});
const productSchema = z.object({
  '@type': z.literal('Product'),
  name: z.string().min(1),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  offers: z.union([offerSchema, z.array(offerSchema)]).optional(),
});

type SportmasterOfferType = z.infer<typeof offerSchema>;

function httpsUrlOf(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;

  const url = URL.parse(value);

  return url?.protocol === 'https:' ? url.href : null;
}

export class SportmasterProductParser {
  constructor(private readonly references: MarketplaceReferenceParserPort) {}

  /** Returns null when the page has no valid JSON-LD card of the product. */
  parse(
    reference: ProductReferenceEntity,
    page: SportmasterPageInterface,
  ): ProductSnapshotInterface | null {
    if (!this.isPageOf(reference, page.url)) return null;

    const product = this.readProduct(page.structuredData);
    if (product === null) return null;

    const offers =
      product.offers === undefined
        ? []
        : Array.isArray(product.offers)
          ? product.offers
          : [product.offers];
    // Multiple offers may belong to different sellers: do not select one of them arbitrarily.
    const offer = offers.length === 1 ? offers[0] : undefined;
    const amountMinor = this.readAmountMinor(offer?.price);
    const prices: PriceObservationInterface[] =
      amountMinor === null ? [] : [{ amountMinor, currency: 'RUB' }];

    return {
      title: product.name,
      observedAt: new Date().toISOString(),
      prices,
      availability: this.readAvailability(offer),
      imageUrl: httpsUrlOf(Array.isArray(product.image) ? product.image[0] : product.image),
    };
  }

  private readProduct(texts: readonly string[]): z.infer<typeof productSchema> | null {
    for (const text of texts) {
      for (const value of this.parseJson(text)) {
        const product = productSchema.safeParse(value);
        if (product.success) return product.data;
      }
    }

    return null;
  }

  private parseJson(text: string): unknown[] {
    try {
      const value: unknown = JSON.parse(text);
      const values = z.array(z.unknown()).safeParse(value);

      return values.success ? values.data : [value];
    } catch {
      return [];
    }
  }

  private readAmountMinor(rubles: string | number | undefined): number | null {
    if (
      rubles === undefined ||
      (typeof rubles === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(rubles.trim()))
    )
      return null;

    const amountMinor = Math.round(Number(rubles) * 100);

    return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : null;
  }

  private readAvailability(
    offer: SportmasterOfferType | undefined,
  ): ProductSnapshotInterface['availability'] {
    if (offer?.availability?.endsWith('/InStock') === true) return 'in_stock';
    if (offer?.availability?.endsWith('/OutOfStock') === true) return 'out_of_stock';

    return 'unknown';
  }

  private isPageOf(reference: ProductReferenceEntity, url: string): boolean {
    try {
      return this.references.parse(new URL(url))?.id === reference.id;
    } catch {
      return false;
    }
  }
}
