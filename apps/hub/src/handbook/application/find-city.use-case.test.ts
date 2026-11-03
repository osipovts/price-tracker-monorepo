import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryHandbookRepositoryAdapter } from '../infrastructure/in-memory-handbook-repository.adapter.js';
import { FindCityUseCase } from './find-city.use-case.js';

const moscow = { id: '-1257403', name: 'Москва', region: null, aliases: ['-442733'] };
const kolpino = { id: '-442733-own', name: 'Колпино', region: null };

void test('finds a city by its id, or by one of its aliases, the own id first', async (): Promise<void> => {
  const handbooks = new InMemoryHandbookRepositoryAdapter();
  await handbooks.saveCities('wildberries-cities', [kolpino, moscow], new Date());
  const find = new FindCityUseCase(handbooks);

  assert.deepEqual(await find.execute('wildberries', '-1257403'), moscow);
  assert.deepEqual(await find.execute('wildberries', '-442733'), moscow);
  assert.deepEqual(await find.execute('wildberries', '-442733-own'), kolpino);
  assert.equal(await find.execute('wildberries', 'unknown'), null);
  assert.equal(await find.execute('ozon', '-1257403'), null);
});
