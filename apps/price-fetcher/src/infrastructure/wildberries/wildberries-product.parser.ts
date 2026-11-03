import type { MarketplaceReferenceParserPort, ProductReferenceEntity } from 'product-reference';
import { z } from 'zod';

import type { ProductSnapshotInterface } from '../../domain/product/product-snapshot.interface.js';
import type { WildberriesPageInterface } from './wildberries-page.interface.js';

/** A size of the product: its price is in kopecks, and a size that is out of stock has none or no stocks. */
const sizeSchema = z.object({
  price: z.object({ product: z.number().int().nonnegative() }).optional(),
  stocks: z.array(z.unknown()).optional(),
});
const productSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  sizes: z.array(sizeSchema),
  totalQuantity: z.number().optional(),
});
const productsSchema = z.object({ products: z.array(z.unknown()) });
// Older versions of the card service wrap the products in `data`.
const cardSchema = z.union([productsSchema, z.object({ data: productsSchema })]);

/** The pictures of Wildberries are served in sizes, named by the folder before the file: `c246x328` is a thumbnail. */
const wildberriesPicturePath = /^(\/vol\d+\/part\d+\/\d+\/images\/)[^/]+(\/[^/]+)$/;
const thumbnailFolder = 'c246x328';

/**
 * An address a browser can load: the page may give a relative one, or none. A picture of the CDN of Wildberries
 * is the small size of it: a card shows it at less than 120 pixels.
 */
function httpUrlOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    const parts = url.hostname.endsWith('.wbbasket.ru')
      ? wildberriesPicturePath.exec(url.pathname)
      : null;
    if (parts?.[1] !== undefined && parts[2] !== undefined) {
      url.pathname = `${parts[1]}${thumbnailFolder}${parts[2]}`;
    }

    return url.href;
  } catch {
    return null;
  }
}

export class WildberriesProductParser {
  constructor(private readonly references: MarketplaceReferenceParserPort) {}

  /** Returns null when the page is not the card of the product or the card service did not describe it. */
  parse(
    reference: ProductReferenceEntity,
    page: WildberriesPageInterface,
  ): ProductSnapshotInterface | null {
    const product = this.isPageOf(reference, page.url)
      ? this.readProduct(reference, page.card)
      : null;
    if (product === null) return null;

    const availability = this.readAvailability(product);
    const prices = product.sizes.flatMap((size): number[] =>
      size.price === undefined || (availability === 'in_stock' && size.stocks?.length === 0)
        ? []
        : [size.price.product],
    );

    return {
      title: product.name,
      observedAt: new Date().toISOString(),
      // The sizes of a product may differ in price: the page offers it from the lowest.
      prices: prices.length > 0 ? [{ amountMinor: Math.min(...prices), currency: 'RUB' }] : [],
      availability,
      imageUrl: httpUrlOf(page.imageUrl),
    };
  }

  private readProduct(
    reference: ProductReferenceEntity,
    card: string,
  ): z.infer<typeof productSchema> | null {
    const parsed = cardSchema.safeParse(this.parseJson(card));
    if (!parsed.success) return null;

    const products = 'data' in parsed.data ? parsed.data.data.products : parsed.data.products;
    for (const value of products) {
      const product = productSchema.safeParse(value);
      if (product.success && String(product.data.id) === reference.id) return product.data;
    }

    return null;
  }

  private readAvailability(
    product: z.infer<typeof productSchema>,
  ): ProductSnapshotInterface['availability'] {
    if (product.totalQuantity !== undefined)
      return product.totalQuantity > 0 ? 'in_stock' : 'out_of_stock';
    if (product.sizes.every((size): boolean => size.stocks === undefined)) return 'unknown';

    return product.sizes.some((size): boolean => (size.stocks?.length ?? 0) > 0)
      ? 'in_stock'
      : 'out_of_stock';
  }

  private isPageOf(reference: ProductReferenceEntity, url: string): boolean {
    try {
      return this.references.parse(new URL(url))?.id === reference.id;
    } catch {
      return false;
    }
  }

  private parseJson(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
}
