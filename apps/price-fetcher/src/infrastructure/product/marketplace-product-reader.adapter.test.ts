import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProductReferenceEntity } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import { MarketplaceProductReaderAdapter } from './marketplace-product-reader.adapter.js';

const proxy = new ProxyEndpointEntity('socks5://217.71.230.1:1080');

function failing(status: 'parse_error' | 'network_error'): {
  read: () => Promise<ReadProductResultType>;
} {
  return { read: (): Promise<ReadProductResultType> => Promise.resolve({ status }) };
}

void test('delegates reading to the reader of the reference marketplace, one product after another', async (): Promise<void> => {
  const read: string[] = [];
  const reader = new MarketplaceProductReaderAdapter({
    ozon: {
      read: (reference): Promise<ReadProductResultType> => {
        read.push(reference.id);

        return Promise.resolve({ status: 'parse_error' });
      },
    },
    dns: failing('network_error'),
    wildberries: failing('network_error'),
    citilink: failing('network_error'),
  });

  const results = await reader.readMany(
    [
      new ProductReferenceEntity('ozon', '1', 'https://www.ozon.ru/product/1/'),
      new ProductReferenceEntity('ozon', '2', 'https://www.ozon.ru/product/2/'),
    ],
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(results, [{ status: 'parse_error' }, { status: 'parse_error' }]);
  assert.deepEqual(read, ['1', '2']);
});

void test('gives the products of a marketplace that reads several at once to its batch reader', async (): Promise<void> => {
  const reader = new MarketplaceProductReaderAdapter(
    {
      ozon: failing('network_error'),
      dns: failing('network_error'),
      wildberries: failing('network_error'),
      citilink: failing('network_error'),
    },
    {
      wildberries: {
        readMany: (references): Promise<ReadProductResultType[]> =>
          Promise.resolve(references.map((): ReadProductResultType => ({ status: 'parse_error' }))),
      },
    },
  );

  const results = await reader.readMany(
    [
      new ProductReferenceEntity(
        'wildberries',
        '1',
        'https://www.wildberries.ru/catalog/1/detail.aspx',
      ),
      new ProductReferenceEntity(
        'wildberries',
        '2',
        'https://www.wildberries.ru/catalog/2/detail.aspx',
      ),
    ],
    proxy,
    new AbortController().signal,
  );

  assert.deepEqual(results, [{ status: 'parse_error' }, { status: 'parse_error' }]);
});
