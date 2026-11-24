import type { MarketplaceReferenceParserPort, ProductReferenceEntity } from 'product-reference';

import type {
  PriceObservationInterface,
  ProductSnapshotInterface,
} from '../../domain/product/product-snapshot.interface.js';
import type { CifrusPageInterface } from './cifrus-page.interface.js';

const offerPricePattern = /^\d+(?:\.\d{1,2})?$/;
const displayedPricePattern = /(\d[\d\s\u00a0]*)(?:[.,](\d{1,2}))?\s*(?:руб\.?|₽)/iu;

function httpsUrlOf(value: string): string | null {
  if (value === '') return null;

  const url = URL.parse(value);

  return url?.protocol === 'https:' ? url.href : null;
}

export class CifrusProductParser {
  constructor(private readonly references: MarketplaceReferenceParserPort) {}

  /** Returns null when the page is not the card of the requested product. */
  parse(
    reference: ProductReferenceEntity,
    page: CifrusPageInterface,
  ): ProductSnapshotInterface | null {
    if (!this.isPageOf(reference, page.url) || page.heading === '') return null;

    const availability = this.readAvailability(page);
    const amountMinor = this.readAmountMinor(page, availability);
    const prices: PriceObservationInterface[] =
      amountMinor === null ? [] : [{ amountMinor, currency: 'RUB' }];

    return {
      title: page.heading,
      observedAt: new Date().toISOString(),
      prices,
      availability,
      imageUrl: httpsUrlOf(page.imageUrl),
    };
  }

  private readAvailability(page: CifrusPageInterface): ProductSnapshotInterface['availability'] {
    if (/\/InStock$/i.test(page.offerAvailability)) return 'in_stock';
    if (/\/(?:OutOfStock|Discontinued|SoldOut)$/i.test(page.offerAvailability)) {
      return 'out_of_stock';
    }
    if (page.hasOutOfStockBadge && !page.hasBuyButton) return 'out_of_stock';
    if (page.hasBuyButton) return 'in_stock';

    return 'unknown';
  }

  private readAmountMinor(
    page: CifrusPageInterface,
    availability: ProductSnapshotInterface['availability'],
  ): number | null {
    // Discontinued/out-of-stock Cifrus pages keep a stale <meta itemprop="price"> while clearing .product-price.
    if (availability === 'out_of_stock') return null;

    const offerAmount =
      page.displayedPriceText !== '' || availability === 'in_stock'
        ? this.readOfferAmountMinor(page.offerPrice, page.offerCurrency)
        : null;

    return offerAmount ?? this.readDisplayedAmountMinor(page.displayedPriceText);
  }

  private readOfferAmountMinor(price: string, currency: string): number | null {
    if (currency !== '' && currency !== 'RUB') return null;

    const normalized = price.trim();
    if (!offerPricePattern.test(normalized)) return null;

    return this.toMinorUnits(Number(normalized));
  }

  private readDisplayedAmountMinor(priceText: string): number | null {
    const match = displayedPricePattern.exec(priceText);
    if (match?.[1] === undefined) return null;

    const whole = match[1].replace(/\s+/g, '');
    const numeric = match[2] === undefined ? whole : `${whole}.${match[2]}`;

    return this.toMinorUnits(Number(numeric));
  }

  private toMinorUnits(rubles: number): number | null {
    if (!Number.isFinite(rubles)) return null;

    const amountMinor = Math.round(rubles * 100);

    return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : null;
  }

  private isPageOf(reference: ProductReferenceEntity, url: string): boolean {
    try {
      return this.references.parse(new URL(url))?.id === reference.id;
    } catch {
      return false;
    }
  }
}
