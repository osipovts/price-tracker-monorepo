import type { MarketplaceType } from './marketplace.type.js';
import type { MarketplaceReferenceParserPort } from './marketplace-reference-parser.port.js';
import { ProductReferenceEntity } from './product-reference.entity.js';

export class AptekaReferenceParser implements MarketplaceReferenceParserPort {
  readonly marketplace: MarketplaceType = 'apteka';

  parse(url: URL): ProductReferenceEntity | null {
    const id = /^(?:\/[a-z0-9_-]+)?\/product\/(?:[\w%-]+-)?([\da-f]{24})\/?$/i.exec(
      url.pathname,
    )?.[1];
    if (
      url.protocol !== 'https:' ||
      !['apteka.ru', 'www.apteka.ru'].includes(url.hostname) ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      id === undefined
    )
      return null;

    const canonicalId = id.toLowerCase();

    return new ProductReferenceEntity(
      this.marketplace,
      canonicalId,
      `https://apteka.ru/product/${canonicalId}/`,
    );
  }
}
