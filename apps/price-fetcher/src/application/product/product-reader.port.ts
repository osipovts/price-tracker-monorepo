import type { ProductReferenceEntity } from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';

export interface ProductReaderPort {
  read(
    reference: ProductReferenceEntity,
    proxy: ProxyEndpointEntity | null,
    signal: AbortSignal,
  ): Promise<ReadProductResultType>;
}
