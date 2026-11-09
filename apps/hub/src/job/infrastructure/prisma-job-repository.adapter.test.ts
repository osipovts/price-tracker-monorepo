import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';
import { JobEntity } from '../domain/job.entity.js';
import { PrismaJobRepositoryAdapter } from './prisma-job-repository.adapter.js';

/** Needs a Postgres with the migrations applied: set TEST_DATABASE_URL to run it (never a database with data that matters). */
const url = process.env['TEST_DATABASE_URL'];
const skip = url === undefined ? 'TEST_DATABASE_URL is not set' : false;

let prisma: PrismaClient;
let jobs: PrismaJobRepositoryAdapter;
const subject = `test-${randomUUID()}`;

before((): void => {
  if (url === undefined) return;

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  jobs = new PrismaJobRepositoryAdapter(prisma);
});

after(async (): Promise<void> => {
  if (url === undefined) return;

  await prisma.jobRecord.deleteMany({ where: { subject } });
  await prisma.$disconnect();
});

const minute = 60_000;
const queued = (createdAt: Date): JobEntity =>
  JobEntity.queued(randomUUID(), 'handbook_fetch', subject, null, createdAt, null);

void test(
  'tells whether a job of the kind is on its way, and when the latest one ended',
  { skip },
  async (): Promise<void> => {
    const now = Date.now();
    const since = new Date(now - 60 * minute);
    const before = await jobs.activity('handbook_fetch', since);

    await jobs.save(queued(new Date(now - 50 * minute)).completed(new Date(now - 40 * minute)));
    await jobs.save(
      queued(new Date(now - 30 * minute)).failed('down', false, new Date(now - 20 * minute)),
    );
    const idle = await jobs.activity('handbook_fetch', since);
    assert.ok(idle.lastFinishedAt !== null);
    assert.ok(idle.lastFinishedAt.getTime() >= now - 20 * minute);
    assert.equal(idle.active, before.active);

    await jobs.save(queued(new Date(now - 5 * minute)));
    assert.equal((await jobs.activity('handbook_fetch', since)).active, true);
    assert.equal((await jobs.activity('handbook_fetch', new Date(now))).active, before.active);
  },
);

void test(
  'counts the jobs by kind, the unfinished and the lost ones, and the ended ones by the hour',
  { skip },
  async (): Promise<void> => {
    const hour = 60 * minute;
    const now = Math.floor(Date.now() / hour) * hour + 30 * minute;
    const since = new Date(now - 24 * hour);
    const lostBefore = new Date(now - hour);
    const before = {
      kinds: await jobs.countByKind(since),
      unfinished: await jobs.countUnfinished(lostBefore),
      hours: await jobs.countFinishedByHour('handbook_fetch', since),
    };

    await jobs.save(queued(new Date(now - 3 * hour)).completed(new Date(now - 2 * hour)));
    await jobs.save(
      queued(new Date(now - 3 * hour)).failed('down', false, new Date(now - 2 * hour + minute)),
    );
    await jobs.save(queued(new Date(now - 2 * hour)));
    await jobs.save(queued(new Date(now - 10 * minute)).started(new Date(now - 5 * minute)));

    const handbooks = (await jobs.countByKind(since)).find(({ kind }) => kind === 'handbook_fetch');
    const handbooksBefore = before.kinds.find(({ kind }) => kind === 'handbook_fetch');
    assert.ok(handbooks !== undefined && handbooksBefore !== undefined);
    assert.equal(handbooks.completed - handbooksBefore.completed, 1);
    assert.equal(handbooks.failed - handbooksBefore.failed, 1);
    assert.equal(handbooks.queued - handbooksBefore.queued, 1);

    const unfinished = await jobs.countUnfinished(lostBefore);
    assert.equal(unfinished.lost - before.unfinished.lost, 1);
    assert.equal(unfinished.running - before.unfinished.running, 1);

    const endedAt = now - 2 * hour - 30 * minute;
    const ofHour = (hours: typeof before.hours): { completed: number; failed: number } =>
      hours.find((each): boolean => each.hour.getTime() === endedAt) ?? {
        completed: 0,
        failed: 0,
      };
    const hours = await jobs.countFinishedByHour('handbook_fetch', since);
    assert.equal(ofHour(hours).completed - ofHour(before.hours).completed, 1);
    assert.equal(ofHour(hours).failed - ofHour(before.hours).failed, 1);
  },
);
