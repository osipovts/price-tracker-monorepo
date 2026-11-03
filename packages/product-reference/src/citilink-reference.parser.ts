import type { MarketplaceType } from './marketplace.type.js';
import type { MarketplaceReferenceParserPort } from './marketplace-reference-parser.port.js';
import { ProductReferenceEntity } from './product-reference.entity.js';

export class CitilinkReferenceParser implements MarketplaceReferenceParserPort {
  readonly marketplace: MarketplaceType = 'citilink';

  parse(url: URL): ProductReferenceEntity | null {
    // The id ends the name of the product; the pages of its properties and reviews stand for the product.
    const id = /^\/product\/(?:[\w%-]+-)?(\d+)(?:\/|$)/.exec(url.pathname)?.[1];
    if (
      url.protocol !== 'https:' ||
      !['citilink.ru', 'www.citilink.ru'].includes(url.hostname) ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      id === undefined
    )
      return null;

    return new ProductReferenceEntity(
      this.marketplace,
      id,
      `https://www.citilink.ru/product/${id}/`,
    );
  }
}
