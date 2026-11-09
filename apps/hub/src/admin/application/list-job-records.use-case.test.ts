import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type JobKindType, ListJobsUseCase } from '../../job/application/index.js';
import { JobEntity } from '../../job/domain/job.entity.js';
import { InMemoryJobRepositoryAdapter } from '../../job/infrastructure/in-memory-job-repository.adapter.js';
import type { ProductDescriptionInterface } from '../../product/application/index.js';
import { ListJobRecordsUseCase } from './list-job-records.use-case.js';

const now = new Date('2026-10-31T12:00:00Z');
const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);
const productId = '3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a21';
const product: ProductDescriptionInterface = {
  id: productId,
  marketplace: 'ozon',
  url: 'https://www.ozon.ru/product/1/',
  cityName: 'Москва',
  title: 'Phone',
};

async function setup(): Promise<{
  jobs: InMemoryJobRepositoryAdapter;
  records: ListJobRecordsUseCase;
}> {
  const jobs = new InMemoryJobRepositoryAdapter();
  const queued = (id: string, kind: JobKindType, subject: string, minutes: number): JobEntity =>
    JobEntity.queued(
      `3f0c9a52-7a53-4a64-9d0d-2f2f6c1f0a${id}`,
      kind,
      subject,
      null,
      minutesAgo(minutes),
      null,
    );
  await jobs.save(queued('11', 'price_fetch', productId, 10).completed(minutesAgo(9)));
  await jobs.save(queued('12', 'price_fetch', 'wildberries', 8).started(minutesAgo(7)));
  await jobs.save(queued('13', 'proxy_fetch', 'proxifly', 90));
  await jobs.save(
    queued('14', 'handbook_fetch', 'dns-cities', 5).failed('down', false, minutesAgo(4)),
  );

  return {
    jobs,
    records: new ListJobRecordsUseCase(
      new ListJobsUseCase(jobs),
      {
        execute: (ids: readonly string[]): Promise<ProductDescriptionInterface[]> =>
          Promise.resolve(ids.includes(productId) ? [product] : []),
      },
      { now: (): Date => now },
    ),
  };
}

void test('names the product a price job reads, and tells the lost jobs', async (): Promise<void> => {
  const { records } = await setup();

  const page = await records.execute({}, { page: 1, pageSize: 10 });

  assert.equal(page.total, 4);
  assert.deepEqual(
    page.items.map(({ job, lost, product: described }): [string, boolean, string | null] => [
      job.snapshot.subject,
      lost,
      described?.title ?? null,
    ]),
    [
      ['dns-cities', false, null],
      ['wildberries', false, null],
      [productId, false, 'Phone'],
      ['proxifly', true, null],
    ],
  );
});

void test('filters by the kind and by where the job is', async (): Promise<void> => {
  const { records } = await setup();
  const subjects = async (
    filter: Parameters<ListJobRecordsUseCase['execute']>[0],
  ): Promise<string[]> =>
    (await records.execute(filter, { page: 1, pageSize: 10 })).items.map(
      ({ job }) => job.snapshot.subject,
    );

  assert.deepEqual(await subjects({ state: 'active' }), ['wildberries', 'proxifly']);
  assert.deepEqual(await subjects({ state: 'failed' }), ['dns-cities']);
  assert.deepEqual(await subjects({ kind: 'price_fetch', state: 'completed' }), [productId]);
});
