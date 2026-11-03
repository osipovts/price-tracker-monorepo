import type { MarketplaceType } from './marketplace.type.js';
import type { MarketplaceReferenceParserPort } from './marketplace-reference-parser.port.js';
import { ProductReferenceEntity } from './product-reference.entity.js';

export class WildberriesReferenceParser implements MarketplaceReferenceParserPort {
  readonly marketplace: MarketplaceType = 'wildberries';

  parse(url: URL): ProductReferenceEntity | null {
    const id = /^\/catalog\/(\d+)\/detail\.aspx$/.exec(url.pathname)?.[1];
    if (
      url.protocol !== 'https:' ||
      !['wildberries.ru', 'www.wildberries.ru', 'wb.ru', 'www.wb.ru'].includes(url.hostname) ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      id === undefined
    )
      return null;

    return new ProductReferenceEntity(
      this.marketplace,
      id,
      `https://www.wildberries.ru/catalog/${id}/detail.aspx`,
    );
  }
}
