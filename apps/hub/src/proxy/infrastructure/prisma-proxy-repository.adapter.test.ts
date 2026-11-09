import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../generated/prisma/client.js';
import { manualProxySource, ProxyEntity } from '../domain/proxy.entity.js';
import { PrismaProxyRepositoryAdapter } from './prisma-proxy-repository.adapter.js';

/** Needs a Postgres with the migrations applied: set TEST_DATABASE_URL to run it (never a database with data that matters). */
const url = process.env['TEST_DATABASE_URL'];
const skip = url === undefined ? 'TEST_DATABASE_URL is not set' : false;

let prisma: PrismaClient;
let proxies: PrismaProxyRepositoryAdapter;
const country = `T${randomUUID().slice(0, 1).toUpperCase()}`;

before((): void => {
  if (url === undefined) return;

  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  proxies = new PrismaProxyRepositoryAdapter(prisma);
});

after(async (): Promise<void> => {
  if (url === undefined) return;

  await prisma.proxy.deleteMany({ where: { server: { startsWith: 'socks5://198.51.100.' } } });
  await prisma.$disconnect();
});

function proxy(n: number, disabledAt: Date | null): ProxyEntity {
  return new ProxyEntity({
    server: `socks5://198.51.100.${String(n)}:1080`,
    source: 'github-free-proxy-list',
    country,
    exitIp: null,
    alive: true,
    latencyMs: 100,
    checksTotal: 1,
    checksAlive: 1,
    lastCheckedAt: new Date('2026-10-31T10:00:00Z'),
    lastSeenAt: new Date('2026-10-31T10:00:00Z'),
    disabledAt,
    credentials: null,
  });
}

void test(
  'keeps who is turned off, lists them apart from the others, and deletes one',
  { skip },
  async (): Promise<void> => {
    const off = new Date('2026-10-31T11:00:00Z');
    await proxies.saveMany([proxy(1, null), proxy(2, off)]);

    const page = { page: 1, pageSize: 10 };
    const listed = async (disabled: boolean): Promise<string[]> =>
      (await proxies.list({ country, disabled }, page)).items.map(
        (item): string => item.snapshot.server,
      );

    assert.deepEqual(await listed(true), ['socks5://198.51.100.2:1080']);
    assert.deepEqual(await listed(false), ['socks5://198.51.100.1:1080']);
    assert.deepEqual(
      (await proxies.findByServers(['socks5://198.51.100.2:1080']))[0]?.snapshot.disabledAt,
      off,
    );

    assert.equal(await proxies.deleteMany(['socks5://198.51.100.1:1080']), 1);
    assert.equal(await proxies.deleteMany(['socks5://198.51.100.1:1080']), 0);
  },
);

void test(
  'lists proxies of equal quality in one order, whether they are turned off or not',
  { skip },
  async (): Promise<void> => {
    await proxies.saveMany([10, 11, 12, 13].map((n): ProxyEntity => proxy(n, null)));
    const order = async (): Promise<string[]> =>
      (await proxies.list({ country }, { page: 1, pageSize: 10 })).items.map(
        (item): string => item.snapshot.server,
      );
    const before = await order();

    await proxies.saveMany([proxy(11, new Date('2026-10-31T11:00:00Z'))]);
    assert.deepEqual(await order(), before);
    await proxies.saveMany([proxy(11, null)]);
    assert.deepEqual(await order(), before);
  },
);

void test(
  'saves the result of checks without undoing what an administrator set after they were read',
  { skip },
  async (): Promise<void> => {
    const off = new Date('2026-10-31T11:00:00Z');
    await proxies.saveMany([proxy(20, off)]);
    const checked = proxy(20, null);

    await proxies.saveChecked([
      new ProxyEntity({ ...checked.snapshot, checksTotal: 2, checksAlive: 2 }),
    ]);

    const [stored] = await proxies.findByServers(['socks5://198.51.100.20:1080']);
    assert.deepEqual(stored?.snapshot.disabledAt, off);
    assert.equal(stored.snapshot.checksTotal, 2);
  },
);

void test('creates the proxy that a check found', { skip }, async (): Promise<void> => {
  await proxies.saveChecked([proxy(21, null)]);

  const [stored] = await proxies.findByServers(['socks5://198.51.100.21:1080']);
  assert.equal(stored?.snapshot.alive, true);
  assert.equal(stored.snapshot.disabledAt, null);
});

void test(
  'lists the found proxies no list named since a time, the longest unchecked first, and deletes them',
  { skip },
  async (): Promise<void> => {
    const since = new Date('2026-10-31T09:00:00Z');
    const unseen = (n: number, checkedAt: string, source = 'proxifly'): ProxyEntity =>
      new ProxyEntity({
        ...proxy(n, null).snapshot,
        source,
        lastCheckedAt: new Date(checkedAt),
        lastSeenAt: new Date('2026-10-31T08:00:00Z'),
      });
    await proxies.saveMany([
      unseen(30, '2026-10-31T08:30:00Z'),
      unseen(31, '2026-10-31T08:10:00Z'),
      unseen(32, '2026-10-31T08:20:00Z', manualProxySource),
      proxy(33, null),
    ]);

    const listed = (await proxies.listUnseen(since, 10))
      .map((item): string => item.snapshot.server)
      .filter((server): boolean => server.startsWith('socks5://198.51.100.3'));

    assert.deepEqual(listed, ['socks5://198.51.100.31:1080', 'socks5://198.51.100.30:1080']);
    assert.equal(
      await proxies.deleteMany(['socks5://198.51.100.31:1080', 'socks5://198.51.100.99:1080']),
      1,
    );
  },
);

void test(
  'counts the proxies by source, and lists the ones of a source',
  { skip },
  async (): Promise<void> => {
    const source = `test-${randomUUID()}`;
    const ofSource = (n: number, alive: boolean, disabledAt: Date | null): ProxyEntity =>
      new ProxyEntity({ ...proxy(n, disabledAt).snapshot, source, alive });
    await proxies.saveMany([
      ofSource(30, true, null),
      ofSource(31, false, null),
      ofSource(32, true, new Date('2026-10-31T11:00:00Z')),
    ]);

    const { bySource } = await proxies.stats();
    assert.deepEqual(
      bySource.find((stats): boolean => stats.source === source),
      { source, total: 3, alive: 2, disabled: 1 },
    );
    assert.equal((await proxies.list({ source }, { page: 1, pageSize: 10 })).total, 3);
  },
);
