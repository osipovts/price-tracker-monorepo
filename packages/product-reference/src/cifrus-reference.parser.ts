import type { MarketplaceType } from './marketplace.type.js';
import type { MarketplaceReferenceParserPort } from './marketplace-reference-parser.port.js';
import { ProductReferenceEntity } from './product-reference.entity.js';

const cifrusHostPattern = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)?cifrus\.ru$/i;
const cifrusPathPattern =
  /^\/description\/(\d+)\/([a-z0-9_-]+)(?:\/(?:harakteristiki|otzyvy))?\/?$/i;

export class CifrusReferenceParser implements MarketplaceReferenceParserPort {
  readonly marketplace: MarketplaceType = 'cifrus';

  parse(url: URL): ProductReferenceEntity | null {
    const match = cifrusPathPattern.exec(url.pathname);
    if (
      url.protocol !== 'https:' ||
      !cifrusHostPattern.test(url.hostname) ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      match?.[1] === undefined ||
      match[2] === undefined
    )
      return null;

    const canonicalId = `${match[1]}/${match[2].toLowerCase()}`;

    return new ProductReferenceEntity(
      this.marketplace,
      canonicalId,
      `https://www.cifrus.ru/description/${canonicalId}`,
    );
  }
}
