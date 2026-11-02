import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OzonReferenceParser, ResolveProductReferenceUseCase } from 'product-reference';

import { InMemoryRateLimiterAdapter } from '../../shared/infrastructure/in-memory-rate-limiter.adapter.js';
import { InMemoryPriceObservationRepositoryAdapter } from '../infrastructure/in-memory-price-observation-repository.adapter.js';
import { InMemoryProductGroupRepositoryAdapter } from '../infrastructure/in-memory-product-group-repository.adapter.js';
import { InMemoryTrackedProductRepositoryAdapter } from '../infrastructure/in-memory-tracked-product-repository.adapter.js';
import { AddProductUseCase } from './add-product.use-case.js';
import { noPriceReads, unlimitedProducts } from './add-product-defaults.type.js';
import { ProductGoneError } from './product-gone.error.js';

const jane = '6b1f4d1e-52f2-4d51-8a0e-0d6a9d3a7c22';

/** The last tracker removed the product between the add and the subscribe of the user. */
class RacedRepository extends InMemoryTrackedProductRepositoryAdapter {
  gone = 1;

  override async subscribe(userId: string, productId: string): Promise<boolean> {
    if (this.gone > 0) {
      this.gone -= 1;
      throw new ProductGoneError(productId);
    }

    return super.subscribe(userId, productId);
  }
}

void test('tracks the product again when it was removed under the user, instead of failing', async (): Promise<void> => {
  const products = new RacedRepository();
  const add = new AddProductUseCase(
    new ResolveProductReferenceUseCase([new OzonReferenceParser()]),
    products,
    new InMemoryProductGroupRepositoryAdapter(),
    new InMemoryPriceObservationRepositoryAdapter(),
    noPriceReads,
    new InMemoryRateLimiterAdapter(),
    unlimitedProducts,
  );

  const { product, created } = await add.execute(jane, 'https://www.ozon.ru/product/1/');

  assert.equal(created, true);
  assert.equal(
    (await products.findSubscribed(jane, product.snapshot.id))?.snapshot.id,
    product.snapshot.id,
  );
});

void test('gives up when the product is gone again', async (): Promise<void> => {
  const products = new RacedRepository();
  products.gone = 2;
  const add = new AddProductUseCase(
    new ResolveProductReferenceUseCase([new OzonReferenceParser()]),
    products,
    new InMemoryProductGroupRepositoryAdapter(),
    new InMemoryPriceObservationRepositoryAdapter(),
    noPriceReads,
    new InMemoryRateLimiterAdapter(),
    unlimitedProducts,
  );

  await assert.rejects(add.execute(jane, 'https://www.ozon.ru/product/1/'), ProductGoneError);
});
