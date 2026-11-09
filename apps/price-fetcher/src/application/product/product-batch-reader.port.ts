import type { ProductReferenceEntity } from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';

/** Reads several products of one marketplace and one city through one route, in one visit of the site. */
export interface ProductBatchReaderPort {
  /** A result for each reference, in their order. */
  readMany(
    references: readonly ProductReferenceEntity[],
    proxy: ProxyEndpointEntity,
    signal: AbortSignal,
  ): Promise<ReadProductResultType[]>;
}
