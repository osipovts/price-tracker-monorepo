import assert from 'node:assert/strict';
import { test } from 'node:test';

import { InMemoryHandbookRepositoryAdapter } from '../infrastructure/in-memory-handbook-repository.adapter.js';
import { FindCityUseCase } from './find-city.use-case.js';
import { SaveHandbookCitiesUseCase } from './save-handbook-cities.use-case.js';
import { SearchCitiesUseCase } from './search-cities.use-case.js';

const city = (
  id: string,
  name: string,
  region: string | null = null,
): { id: string; name: string; region: string | null } => ({
  id,
  name,
  region,
});

async function setup(): Promise<{ search: SearchCitiesUseCase; find: FindCityUseCase }> {
  const repository = new InMemoryHandbookRepositoryAdapter();
  await new SaveHandbookCitiesUseCase(repository).execute('dns-cities', [
    city('1', 'Абакан'),
    city('2', 'Иваново', 'Ивановская область'),
    city('3', 'Иркутск', 'Иркутская область'),
    city('4', 'Новый Иркутск'),
    city('5', 'Москва'),
  ]);

  return { search: new SearchCitiesUseCase(repository), find: new FindCityUseCase(repository) };
}

void test('finds the cities by a part of the name, the ones that begin with it first', async (): Promise<void> => {
  const { search } = await setup();

  const found = await search.execute('dns', { query: 'ИРК', limit: 10 });

  assert.deepEqual(
    found.map((item): string => item.name),
    ['Иркутск', 'Новый Иркутск'],
  );
  assert.deepEqual(found[0], { id: '3', name: 'Иркутск', region: 'Иркутская область' });
});

void test('without a query gives the first cities by name, up to the limit', async (): Promise<void> => {
  const { search } = await setup();

  const found = await search.execute('dns', { query: '', limit: 2 });

  assert.deepEqual(
    found.map((item): string => item.name),
    ['Абакан', 'Иваново'],
  );
});

void test('has no cities until the handbook is read, and those of Ozon without a read', async (): Promise<void> => {
  const empty = new InMemoryHandbookRepositoryAdapter();

  assert.deepEqual(
    await new SearchCitiesUseCase(empty).execute('dns', { query: '', limit: 5 }),
    [],
  );
  assert.deepEqual(
    await new SearchCitiesUseCase(empty).execute('ozon', { query: 'иркут', limit: 5 }),
    [{ id: 'irkutsk', name: 'Иркутск', region: 'Иркутская обл.' }],
  );
});

void test('finds a city of a marketplace by its id', async (): Promise<void> => {
  const { find } = await setup();

  assert.deepEqual(await find.execute('dns', '3'), {
    id: '3',
    name: 'Иркутск',
    region: 'Иркутская область',
  });
  assert.equal(await find.execute('dns', 'nowhere'), null);
  assert.equal(await find.execute('ozon', '3'), null);
  assert.equal((await find.execute('ozon', 'irkutsk'))?.name, 'Иркутск');
});
