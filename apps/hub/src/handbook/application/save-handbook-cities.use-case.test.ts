import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryHandbookRepositoryAdapter } from '../infrastructure/in-memory-handbook-repository.adapter.js';
import { SaveHandbookCitiesUseCase } from './save-handbook-cities.use-case.js';

const moscow = { id: 'moscow', name: 'Москва', region: null };
const irkutsk = { id: 'irkutsk', name: 'Иркутск', region: 'Иркутская область' };

void test('replaces the cities of the handbook with the ones that were read', async (): Promise<void> => {
  const handbooks = new InMemoryHandbookRepositoryAdapter();
  const save = new SaveHandbookCitiesUseCase(handbooks);

  await save.execute('dns-cities', [moscow]);
  await save.execute('dns-cities', [irkutsk]);

  assert.deepEqual((await handbooks.findCities('dns-cities'))?.cities, [irkutsk]);
});

void test('keeps the cities it has when a read brings none: a fetcher that failed quietly would wipe the handbook', async (): Promise<void> => {
  const handbooks = new InMemoryHandbookRepositoryAdapter();
  const save = new SaveHandbookCitiesUseCase(handbooks);
  await save.execute('dns-cities', [moscow, irkutsk]);

  await save.execute('dns-cities', []);

  assert.deepEqual((await handbooks.findCities('dns-cities'))?.cities, [moscow, irkutsk]);
});

void test('keeps an empty read as read when there was nothing before', async (): Promise<void> => {
  const handbooks = new InMemoryHandbookRepositoryAdapter();

  await new SaveHandbookCitiesUseCase(handbooks).execute('dns-cities', []);

  assert.deepEqual((await handbooks.findCities('dns-cities'))?.cities, []);
});

void test('a city read again keeps the id the handbook gave it', async (): Promise<void> => {
  const handbooks = new InMemoryHandbookRepositoryAdapter();
  const save = new SaveHandbookCitiesUseCase(handbooks);
  await save.execute('wildberries-cities', [
    { id: '-1257403', name: 'Москва', region: null, aliases: ['-442733'] },
  ]);

  await save.execute('wildberries-cities', [
    { id: '-442733', name: 'Москва', region: null, aliases: ['-1257403'] },
  ]);

  assert.deepEqual((await handbooks.findCities('wildberries-cities'))?.cities, [
    { id: '-1257403', name: 'Москва', region: null, aliases: ['-442733'] },
  ]);
});
