import type { MarketplaceType } from './marketplace.type.js';
import type { MarketplaceReferenceParserPort } from './marketplace-reference-parser.port.js';
import { ProductReferenceEntity } from './product-reference.entity.js';

export class SportmasterReferenceParser implements MarketplaceReferenceParserPort {
  readonly marketplace: MarketplaceType = 'sportmaster';

  parse(url: URL): ProductReferenceEntity | null {
    const id = /^\/product\/(\d+)\/?$/.exec(url.pathname)?.[1];
    if (
      url.protocol !== 'https:' ||
      !['sportmaster.ru', 'www.sportmaster.ru'].includes(url.hostname) ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      id === undefined
    )
      return null;

    return new ProductReferenceEntity(
      this.marketplace,
      id,
      `https://www.sportmaster.ru/product/${id}/`,
    );
  }
}
