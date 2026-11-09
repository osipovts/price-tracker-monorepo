import type { MarketplaceType } from 'product-reference';
import type { ProductReferenceEntity } from 'product-reference';
import type { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ProductBatchReaderPort } from '../../application/product/product-batch-reader.port.js';
import type { ProductReaderPort } from '../../application/product/product-reader.port.js';
import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';

/**
 * Routes product references to the reader of their marketplace: one that reads several products in one visit gets
 * them together, another reads them one after another.
 */
export class MarketplaceProductReaderAdapter implements ProductBatchReaderPort {
  constructor(
    private readonly readers: Record<MarketplaceType, ProductReaderPort>,
    private readonly batchReaders: Readonly<
      Partial<Record<MarketplaceType, ProductBatchReaderPort>>
    > = {},
  ) {}

  async readMany(
    references: readonly ProductReferenceEntity[],
    proxy: ProxyEndpointEntity,
    signal: AbortSignal,
  ): Promise<ReadProductResultType[]> {
    const [first] = references;
    if (first === undefined) return [];

    const batchReader = this.batchReaders[first.marketplace];
    if (batchReader !== undefined) return batchReader.readMany(references, proxy, signal);

    const results: ReadProductResultType[] = [];
    for (const reference of references) {
      results.push(await this.readers[reference.marketplace].read(reference, proxy, signal));
    }

    return results;
  }
}
