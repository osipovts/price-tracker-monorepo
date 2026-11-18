import type { MarketplaceType } from './marketplace.type.js';
import type { MarketplaceReferenceParserPort } from './marketplace-reference-parser.port.js';
import { ProductReferenceEntity } from './product-reference.entity.js';

export class AliexpressReferenceParser implements MarketplaceReferenceParserPort {
  readonly marketplace: MarketplaceType = 'aliexpress';

  parse(url: URL): ProductReferenceEntity | null {
    const id = /^\/item\/(?:\d+_)?(\d+)\.html$/.exec(url.pathname)?.[1];
    if (
      url.protocol !== 'https:' ||
      !['aliexpress.ru', 'www.aliexpress.ru'].includes(url.hostname) ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      id === undefined
    )
      return null;

    return new ProductReferenceEntity(
      this.marketplace,
      id,
      `https://aliexpress.ru/item/${id}.html`,
    );
  }
}
