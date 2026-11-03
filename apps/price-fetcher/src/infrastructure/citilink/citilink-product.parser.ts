import type { MarketplaceReferenceParserPort, ProductReferenceEntity } from 'product-reference';

import type {
  PriceObservationInterface,
  ProductSnapshotInterface,
} from '../../domain/product/product-snapshot.interface.js';
import type { CitilinkPageInterface } from './citilink-page.interface.js';
import type { CitilinkStateInterface, CitilinkStateParser } from './citilink-state.parser.js';

type CitilinkProductType = NonNullable<CitilinkStateInterface['product']>;

/** The size of a picture the site serves for a thumbnail: 250 pixels. A card shows it at less than 120. */
const thumbnailSize = 'MD';

export class CitilinkProductParser {
  constructor(
    private readonly references: MarketplaceReferenceParserPort,
    private readonly states: CitilinkStateParser,
  ) {}

  /** Returns null when the page is not the card of the product. */
  parse(
    reference: ProductReferenceEntity,
    page: CitilinkPageInterface,
  ): ProductSnapshotInterface | null {
    const product = this.isPageOf(reference, page.url)
      ? (this.states.parse(page.state)?.product ?? null)
      : null;
    if (product === null || String(product.id) !== reference.id) return null;

    return {
      title: product.name,
      observedAt: new Date().toISOString(),
      prices: this.readPrices(product),
      availability: product.isAvailable ? 'in_stock' : 'out_of_stock',
      imageUrl: this.readPicture(product),
    };
  }

  /**
   * The club price first, the price for everyone after it. The site takes the club price for the price of the
   * product as long as it is not above the other one; a product without it has zero there. A product out of stock
   * has zeros for both and none is shown.
   */
  private readPrices(product: CitilinkProductType): PriceObservationInterface[] {
    const current = this.readAmountMinor(product.price.current);
    const club = this.readAmountMinor(product.price.club ?? 0);
    const amounts =
      club !== null && current !== null && club < current ? [club, current] : [current ?? club];

    return amounts.flatMap((amountMinor): PriceObservationInterface[] =>
      amountMinor === null ? [] : [{ amountMinor, currency: 'RUB' }],
    );
  }

  /** Kopecks of a positive amount in rubles; null for none. */
  private readAmountMinor(rubles: string | number): number | null {
    const amountMinor = Math.round(Number(rubles) * 100);

    return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : null;
  }

  private readPicture(product: CitilinkProductType): string | null {
    const sources = product.images?.[0]?.sources ?? [];
    const source = sources.find(({ size }): boolean => size === thumbnailSize) ?? sources[0];
    const url = source === undefined ? null : URL.parse(source.url);

    return url?.protocol === 'https:' ? url.href : null;
  }

  private isPageOf(reference: ProductReferenceEntity, url: string): boolean {
    try {
      return this.references.parse(new URL(url))?.id === reference.id;
    } catch {
      return false;
    }
  }
}
