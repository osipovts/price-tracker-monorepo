import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProductReferenceEntity } from 'product-reference';
import { ProxyEndpointEntity } from 'proxy-endpoint';

import type { ReadProductResultType } from '../../domain/product/product-snapshot.interface.js';
import { MarketplaceProductReaderAdapter } from './marketplace-product-reader.adapter.js';

void test('delegates reading to the reader of the reference marketplace', async (): Promise<void> => {
  const reader = new MarketplaceProductReaderAdapter({
    ozon: {
      read: (): Promise<ReadProductResultType> => Promise.resolve({ status: 'parse_error' }),
    },
    dns: {
      read: (): Promise<ReadProductResultType> => Promise.resolve({ status: 'network_error' }),
    },
    wildberries: {
      read: (): Promise<ReadProductResultType> => Promise.resolve({ status: 'network_error' }),
    },
    citilink: {
      read: (): Promise<ReadProductResultType> => Promise.resolve({ status: 'network_error' }),
    },
  });

  const result = await reader.read(
    new ProductReferenceEntity('ozon', '1', 'https://www.ozon.ru/product/1/'),
    new ProxyEndpointEntity('socks5://217.71.230.1:1080'),
    new AbortController().signal,
  );

  assert.equal(result.status, 'parse_error');
});
