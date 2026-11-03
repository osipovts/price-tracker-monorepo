import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  manualProxySource,
  ProxyEntity,
  proxyFailureLimit,
  proxyUnseenLimitMs,
} from './proxy.entity.js';

const checkedAt = new Date('2026-10-31T10:00:00Z');
const disabledAt = new Date('2026-10-31T11:00:00Z');

function proxy(overrides: Partial<ReturnType<typeof snapshot>> = {}): ProxyEntity {
  return new ProxyEntity({ ...snapshot(), ...overrides });
}

function snapshot(): ConstructorParameters<typeof ProxyEntity>[0] {
  return {
    server: 'socks5://217.71.230.1:1080',
    source: 'github-free-proxy-list',
    country: 'RU',
    exitIp: '217.71.230.1',
    alive: true,
    latencyMs: 120,
    checksTotal: 4,
    checksAlive: 3,
    lastCheckedAt: checkedAt,
    lastSeenAt: checkedAt,
    disabledAt: null,
    credentials: null,
  };
}

void test('an administrator turns a proxy off and on again, without touching what was checked', (): void => {
  const off = proxy().disabled(disabledAt);

  assert.deepEqual(off.snapshot.disabledAt, disabledAt);
  assert.equal(off.snapshot.alive, true);
  assert.equal(off.enabled().snapshot.disabledAt, null);
  // Turning it off twice keeps the first time.
  assert.deepEqual(
    off.disabled(new Date(disabledAt.getTime() + 1000)).snapshot.disabledAt,
    disabledAt,
  );
});

void test('a check does not turn a proxy back on, dead or alive: only an administrator does', (): void => {
  const off = proxy().disabled(disabledAt);
  const alive = {
    server: off.snapshot.server,
    source: 'github-free-proxy-list',
    alive: true,
    latencyMs: 90,
    country: 'RU',
    exitIp: '217.71.230.1',
    checkedAt: new Date('2026-10-31T12:00:00Z'),
    seen: true,
  };
  const dead = { ...alive, alive: false, latencyMs: null, country: null, exitIp: null };

  assert.deepEqual(ProxyEntity.fromCheck(alive, off).snapshot.disabledAt, disabledAt);
  assert.deepEqual(ProxyEntity.fromCheck(dead, off).snapshot.disabledAt, disabledAt);
  assert.equal(ProxyEntity.fromCheck(alive).snapshot.disabledAt, null);
});

void test('a check that is not newer than the last one counts for nothing: the queue may deliver it twice', (): void => {
  const known = proxy();
  const check = {
    server: known.snapshot.server,
    source: 'github-free-proxy-list',
    alive: false,
    latencyMs: null,
    country: null,
    exitIp: null,
    checkedAt,
    seen: true,
  };

  assert.equal(ProxyEntity.fromCheck(check, known), known);
  assert.equal(
    ProxyEntity.fromCheck({ ...check, checkedAt: new Date(checkedAt.getTime() - 1000) }, known),
    known,
  );
  assert.equal(
    ProxyEntity.fromCheck({ ...check, checkedAt: new Date(checkedAt.getTime() + 1) }, known)
      .snapshot.checksTotal,
    5,
  );
});

void test('a check of a proxy a list names renews when it was seen; a recheck leaves that time and the source as they were', (): void => {
  const known = proxy();
  const later = new Date(checkedAt.getTime() + 60_000);
  const check = {
    server: known.snapshot.server,
    source: 'proxifly',
    alive: false,
    latencyMs: null,
    country: null,
    exitIp: null,
    checkedAt: later,
    seen: true,
  };

  const seen = ProxyEntity.fromCheck(check, known).snapshot;
  const rechecked = ProxyEntity.fromCheck({ ...check, seen: false }, known).snapshot;

  assert.deepEqual(seen.lastSeenAt, later);
  assert.deepEqual(rechecked.lastSeenAt, checkedAt);
  assert.equal(rechecked.checksTotal, 5);
  // The source that found the proxy first keeps it.
  assert.equal(seen.source, 'github-free-proxy-list');
  assert.equal(ProxyEntity.fromCheck(check).snapshot.source, 'proxifly');
});

void test('only a found proxy that is dead, failed enough checks and is unseen for long is expired', (): void => {
  const now = new Date('2026-11-02T00:00:00Z');
  const unseen = new Date(now.getTime() - proxyUnseenLimitMs - 1);
  const expired = proxy({
    alive: false,
    checksTotal: proxyFailureLimit,
    checksAlive: 0,
    lastSeenAt: unseen,
  });

  assert.equal(expired.isExpired(now), true);
  assert.equal(proxy({ ...expired.snapshot, alive: true }).isExpired(now), false);
  assert.equal(
    proxy({ ...expired.snapshot, checksTotal: proxyFailureLimit - 1 }).isExpired(now),
    false,
  );
  assert.equal(
    proxy({
      ...expired.snapshot,
      lastSeenAt: new Date(now.getTime() - proxyUnseenLimitMs),
    }).isExpired(now),
    false,
  );
  assert.equal(proxy({ ...expired.snapshot, source: manualProxySource }).isExpired(now), false);
});
