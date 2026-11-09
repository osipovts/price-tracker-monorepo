import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';
import { ProxyEntity } from '../domain/proxy.entity.js';
import { ProxyReputationEntity } from '../domain/proxy-reputation.entity.js';
import { PrismaProxyRepositoryAdapter } from './prisma-proxy-repository.adapter.js';
import { PrismaProxyReputationRepositoryAdapter } from './prisma-proxy-reputation-repository.adapter.js';

/** Needs a Postgres with the migrations applied: set TEST_DATABASE_URL to run it (never a database with data that matters). */
const url = process.env['TEST_DATABASE_URL'];
const skip = url === undefined ? 'TEST_DATABASE_URL is not set' : false;

let prisma: PrismaClient;
let proxies: PrismaProxyRepositoryAdapter;
let reputations: PrismaProxyReputationRepositoryAdapter;

const server = 'socks5://192.0.2.1:1080';

const attemptedAt = new Date('2026-11-03T08:00:00Z');

before((): void => {
  if (url === undefined) return;

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  proxies = new PrismaProxyRepositoryAdapter(prisma);
  reputations = new PrismaProxyReputationRepositoryAdapter(prisma);
});

after(async (): Promise<void> => {
  if (url === undefined) return;

  await prisma.proxy.deleteMany({ where: { server: { startsWith: 'socks5://192.0.2.' } } });
  await prisma.$disconnect();
});

void test(
  'keeps the reputation of a proxy for each marketplace, and deletes it with the proxy',
  { skip },
  async (): Promise<void> => {
    await proxies.saveMany([ProxyEntity.manual(server, null, attemptedAt)]);
    const blocked = ProxyReputationEntity.fromAttempt({
      server,
      marketplace: 'ozon',
      status: 'challenge_required',
      httpStatus: null,
      stage: null,
      durationMs: null,
      attemptedAt,
    });
    const read = ProxyReputationEntity.fromAttempt({
      server,
      marketplace: 'dns',
      status: 'success',
      httpStatus: null,
      stage: null,
      durationMs: null,
      attemptedAt,
    });
    assert.ok(blocked && read);

    await reputations.saveMany([blocked, read]);
    await reputations.saveMany([blocked]);

    assert.deepEqual(
      (await reputations.findByServers([server], 'ozon'))[0]?.snapshot,
      blocked.snapshot,
    );
    assert.deepEqual(
      (await reputations.findByServers([server]))
        .map(({ snapshot }): string => snapshot.marketplace)
        .toSorted(),
      ['dns', 'ozon'],
    );

    await proxies.deleteMany([server]);
    assert.deepEqual(await reputations.findByServers([server]), []);
  },
);
