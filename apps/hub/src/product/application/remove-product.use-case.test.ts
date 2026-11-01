import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OzonReferenceParser, ResolveProductReferenceUseCase } from 'product-reference';

import { InMemoryObjectStorageAdapter } from '../../shared/infrastructure/in-memory-object-storage.adapter.js';
import { InMemoryRateLimiterAdapter } from '../../shared/infrastructure/in-memory-rate-limiter.adapter.js';
import { InMemoryPriceObservationRepositoryAdapter } from '../infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryProductGroupRepositoryAdapter } from '../infrastructure/in-memory-product-group-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import { AddProductUseCase } from './add-product.use-case.js';
import { noPriceReads, unlimitedProducts } from './add-product-defaults.type.js';
import { ListPriceHistoryUseCase } from './list-price-history.use-case.js';
import { ProductNotFoundError } from './product-not-found.error.js';
import { RemoveProductUseCase } from './remove-product.use-case.js';

const jane = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';
const sam = '9a2d0f3c-0a44-4b6a-b8c2-7e7e2f3b1d33';
const url = 'https://www.ozon.ru/product/1/';
const firstPage = { page: 1, pageSize: 10 };

function setup(): {
  add: AddProductUseCase;
  remove: RemoveProductUseCase;
  list: {
    execute: (
      userId: string,
      pagination: typeof firstPage,
    ) => ReturnType<InMemoryTrackedProductRepositoryAdapter['listSubscribed']>;
  };
  history: ListPriceHistoryUseCase;
  products: InMemoryTrackedProductRepositoryAdapter;
} {
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const observations = new InMemoryPriceObservationRepositoryAdapter();

  return {
    add: new AddProductUseCase(
      new ResolveProductReferenceUseCase([new OzonReferenceParser()]),
      products,
      new InMemoryProductGroupRepositoryAdapter(),
      observations,
      noPriceReads,
      new InMemoryRateLimiterAdapter(),
      unlimitedProducts,
    ),
    remove: new RemoveProductUseCase(products, new InMemoryObjectStorageAdapter(false)),
    list: { execute: (userId, pagination) => products.listSubscribed(userId, pagination) },
    history: new ListPriceHistoryUseCase(products, observations),
    products,
  };
}

void test('stops tracking for the user only while others still track the product', async (): Promise<void> => {
  const { add, remove, list, history, products } = setup();
  const { product } = await add.execute(jane, url);
  await add.execute(sam, url);

  await remove.execute(jane, product.snapshot.id);

  assert.equal((await list.execute(jane, firstPage)).total, 0);
  await assert.rejects(history.execute(jane, product.snapshot.id, firstPage), ProductNotFoundError);
  assert.equal((await list.execute(sam, firstPage)).total, 1);
  assert.notEqual(await products.findById(product.snapshot.id), null);
});

void test('deletes the product for good once nobody tracks it', async (): Promise<void> => {
  const { add, remove, products } = setup();
  const { product } = await add.execute(jane, url);
  await add.execute(sam, url);

  await remove.execute(jane, product.snapshot.id);
  await remove.execute(sam, product.snapshot.id);

  assert.equal(await products.findById(product.snapshot.id), null);
  const again = await add.execute(jane, url);
  assert.equal(again.created, true);
  assert.notEqual(again.product.snapshot.id, product.snapshot.id);
});

void test('refuses a product the user does not track, and a second removal', async (): Promise<void> => {
  const { add, remove } = setup();
  const { product } = await add.execute(jane, url);

  await assert.rejects(remove.execute(sam, product.snapshot.id), ProductNotFoundError);
  await remove.execute(jane, product.snapshot.id);
  await assert.rejects(remove.execute(jane, product.snapshot.id), ProductNotFoundError);
});

void test('deletes the picture with the product, and keeps it while somebody else tracks the product', async (): Promise<void> => {
  const storage = new InMemoryObjectStorageAdapter();
  const products = new InMemoryTrackedProductRepositoryAdapter();
  const { product } = await products.add({
    marketplace: 'ozon',
    externalId: '1',
    url: 'https://www.ozon.ru/product/1/',
    cityId: null,
    cityName: null,
  });
  await products.subscribe('jane', product.snapshot.id);
  await products.subscribe('sam', product.snapshot.id);
  await products.setThumbnail(
    product.snapshot.id,
    'products/1/thumbnail',
    'https://cdn.example/a.jpg',
  );
  await storage.put('products/1/thumbnail', {
    body: new Uint8Array([1]),
    contentType: 'image/jpeg',
  });
  const remove = new RemoveProductUseCase(products, storage);

  await remove.execute('jane', product.snapshot.id);
  assert.equal(storage.objects.size, 1);

  await remove.execute('sam', product.snapshot.id);
  assert.equal(storage.objects.size, 0);
});
