import type { MarketplaceType } from './marketplace.type.js';
import type { MarketplaceReferenceParserPort } from './marketplace-reference-parser.port.js';
import { ProductReferenceEntity } from './product-reference.entity.js';

export class AliexpressReferenceParser implements MarketplaceReferenceParserPort {
  readonly marketplace: MarketplaceType = 'aliexpress';

  static splitId(id: string): { itemId: string; skuId: string | null } {
    const separator = id.indexOf(':');
    if (separator === -1) return { itemId: id, skuId: null };

    const skuId = id.slice(separator + 1);

    return {
      itemId: id.slice(0, separator),
      skuId: skuId === '' ? null : skuId,
    };
  }

  parse(url: URL): ProductReferenceEntity | null {
    const itemId = /^\/item\/(?:\d+_)?(\d+)\.html$/.exec(url.pathname)?.[1];
    if (
      url.protocol !== 'https:' ||
      !['aliexpress.ru', 'www.aliexpress.ru'].includes(url.hostname) ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      itemId === undefined
    )
      return null;

    const rawSkuId = url.searchParams.get('sku_id');
    const skuId = rawSkuId !== null && /^[1-9]\d*$/.test(rawSkuId) ? rawSkuId : null;
    const id = skuId === null ? itemId : `${itemId}:${skuId}`;
    const canonicalUrl =
      skuId === null
        ? `https://aliexpress.ru/item/${itemId}.html`
        : `https://aliexpress.ru/item/${itemId}.html?sku_id=${skuId}`;

    return new ProductReferenceEntity(this.marketplace, id, canonicalUrl);
  }
}
