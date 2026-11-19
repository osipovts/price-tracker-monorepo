import {
  AliexpressReferenceParser,
  type MarketplaceReferenceParserPort,
  type ProductReferenceEntity,
} from 'product-reference';
import { z } from 'zod';

import type {
  PriceObservationInterface,
  ProductSnapshotInterface,
} from '../../domain/product/product-snapshot.interface.js';
import type { AliexpressPageInterface } from './aliexpress-page.interface.js';

const amountSchema = z.object({
  value: z.number().optional(),
  currency: z.string(),
  cents: z.union([z.string(), z.number()]).optional(),
});
const skuPriceSchema = z.object({
  skuId: z.union([z.string(), z.number()]).optional(),
  availQuantity: z.number().optional(),
  activityAmount: amountSchema.nullish(),
  amount: amountSchema.nullish(),
});
const productSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().min(1),
  gallery: z.array(z.object({ imageUrl: z.string().nullish() })).nullish(),
  activeSkuId: z.union([z.string(), z.number()]).nullish(),
  itemStatus: z.number().nullish(),
  quantity: z.object({ totalCount: z.union([z.string(), z.number()]).nullish() }).nullish(),
  price: z
    .object({
      minActivityAmount: amountSchema.nullish(),
      minAmount: amountSchema.nullish(),
    })
    .nullish(),
  skuInfo: z
    .object({
      priceList: z.array(skuPriceSchema).nullish(),
    })
    .nullish(),
});
const productDataSchema = z.object({
  data: productSchema,
});

function httpsUrlOf(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null;

  const url = URL.parse(value);

  return url?.protocol === 'https:' ? url.href : null;
}

export class AliexpressProductParser {
  constructor(private readonly references: MarketplaceReferenceParserPort) {}

  /** Returns null when the page has no valid productData payload of the requested product. */
  parse(
    reference: ProductReferenceEntity,
    page: AliexpressPageInterface,
  ): ProductSnapshotInterface | null {
    const { itemId, skuId: requestedSkuId } = AliexpressReferenceParser.splitId(reference.id);
    if (!this.isPageOf(itemId, page.url)) return null;

    const product = this.readProduct(page.productData);
    if (product === null || String(product.id) !== itemId) return null;

    const priceList = product.skuInfo?.priceList ?? [];
    const activeSku = this.selectSku(product, priceList, requestedSkuId);
    const amount =
      requestedSkuId !== null
        ? (activeSku?.activityAmount ?? activeSku?.amount)
        : (activeSku?.activityAmount ??
          activeSku?.amount ??
          product.price?.minActivityAmount ??
          product.price?.minAmount);
    const amountMinor = this.readAmountMinor(amount);
    const prices: PriceObservationInterface[] =
      amountMinor === null ? [] : [{ amountMinor, currency: 'RUB' }];

    return {
      title: product.name,
      observedAt: new Date().toISOString(),
      prices,
      availability: this.readAvailability(product, priceList, requestedSkuId, activeSku),
      imageUrl: httpsUrlOf(product.gallery?.[0]?.imageUrl),
    };
  }

  private selectSku(
    product: z.infer<typeof productSchema>,
    priceList: ReadonlyArray<z.infer<typeof skuPriceSchema>>,
    requestedSkuId: string | null,
  ): z.infer<typeof skuPriceSchema> | undefined {
    if (requestedSkuId !== null)
      return priceList.find((sku): boolean => String(sku.skuId) === requestedSkuId);

    const activeSkuId =
      product.activeSkuId !== undefined &&
      product.activeSkuId !== null &&
      String(product.activeSkuId) !== '0'
        ? String(product.activeSkuId)
        : null;

    return (
      (activeSkuId === null
        ? undefined
        : priceList.find((sku): boolean => String(sku.skuId) === activeSkuId)) ??
      priceList.find((sku): boolean => (sku.availQuantity ?? 0) > 0) ??
      priceList[0]
    );
  }

  private readProduct(raw: string): z.infer<typeof productSchema> | null {
    try {
      const parsed = productDataSchema.safeParse(JSON.parse(raw));

      return parsed.success ? parsed.data.data : null;
    } catch {
      return null;
    }
  }

  private readAmountMinor(amount: z.infer<typeof amountSchema> | null | undefined): number | null {
    if (amount?.currency !== 'RUB') return null;

    const amountMinor =
      amount.cents !== undefined
        ? Math.round(Number(amount.cents))
        : amount.value !== undefined
          ? Math.round(amount.value * 100)
          : NaN;

    return Number.isSafeInteger(amountMinor) && amountMinor > 0 ? amountMinor : null;
  }

  private readAvailability(
    product: z.infer<typeof productSchema>,
    priceList: ReadonlyArray<z.infer<typeof skuPriceSchema>>,
    requestedSkuId: string | null,
    activeSku: z.infer<typeof skuPriceSchema> | undefined,
  ): ProductSnapshotInterface['availability'] {
    if (product.itemStatus !== undefined && product.itemStatus !== null && product.itemStatus !== 0)
      return 'out_of_stock';

    if (requestedSkuId !== null) {
      if (activeSku === undefined) return 'out_of_stock';
      if (activeSku.availQuantity !== undefined)
        return activeSku.availQuantity > 0 ? 'in_stock' : 'out_of_stock';
    }

    const totalCount = product.quantity?.totalCount;
    if (totalCount !== undefined && totalCount !== null)
      return Number(totalCount) > 0 ? 'in_stock' : 'out_of_stock';

    if (priceList.some((sku): boolean => sku.availQuantity !== undefined))
      return priceList.some((sku): boolean => (sku.availQuantity ?? 0) > 0)
        ? 'in_stock'
        : 'out_of_stock';

    return 'unknown';
  }

  private isPageOf(itemId: string, url: string): boolean {
    try {
      const parsed = this.references.parse(new URL(url));

      return parsed !== null && AliexpressReferenceParser.splitId(parsed.id).itemId === itemId;
    } catch {
      return false;
    }
  }
}
