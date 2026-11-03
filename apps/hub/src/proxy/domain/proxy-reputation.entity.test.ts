import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProxyAttemptInterface } from './proxy-attempt.interface.js';
import { ProxyReputationEntity, reputationHalfLifeMs } from './proxy-reputation.entity.js';

const server = 'socks5://217.71.230.1:1080';

const startedAt = new Date('2026-11-03T08:00:00Z');

const minuteMs = 60_000;

function attempt(
  status: ProxyAttemptInterface['status'],
  minutes = 0,
  httpStatus: number | null = null,
): ProxyAttemptInterface {
  return {
    server,
    marketplace: 'ozon',
    status,
    httpStatus,
    attemptedAt: new Date(startedAt.getTime() + minutes * minuteMs),
  };
}

/** The reputation after the attempts, in order; each of them is about the proxy. */
function after(...attempts: ProxyAttemptInterface[]): ProxyReputationEntity {
  const reputation = attempts.reduce<ProxyReputationEntity | undefined>(
    (known, next): ProxyReputationEntity | undefined =>
      ProxyReputationEntity.fromAttempt(next, known),
    undefined,
  );
  assert.ok(reputation);

  return reputation;
}

function restMinutes(reputation: ProxyReputationEntity, from: number): number | null {
  const until = reputation.snapshot.cooldownUntil;

  return until === null ? null : (until.getTime() - startedAt.getTime()) / minuteMs - from;
}

void test('tells the answers that are about the proxy from those that are about the page', (): void => {
  assert.equal(ProxyReputationEntity.outcomeOf('success', null), 'read');
  assert.equal(ProxyReputationEntity.outcomeOf('partial', null), 'read');
  assert.equal(ProxyReputationEntity.outcomeOf('network_error', null), 'unreachable');
  assert.equal(ProxyReputationEntity.outcomeOf('challenge_required', null), 'blocked');
  assert.equal(ProxyReputationEntity.outcomeOf('proxy_rejected', null), 'misplaced');
  assert.equal(ProxyReputationEntity.outcomeOf('http_error', 401), 'blocked');
  assert.equal(ProxyReputationEntity.outcomeOf('http_error', 403), 'blocked');
  assert.equal(ProxyReputationEntity.outcomeOf('http_error', 429), 'blocked');
  assert.equal(ProxyReputationEntity.outcomeOf('http_error', 407), 'unreachable');
  assert.equal(ProxyReputationEntity.outcomeOf('http_error', 404), null);
  assert.equal(ProxyReputationEntity.outcomeOf('http_error', 502), null);
  assert.equal(ProxyReputationEntity.outcomeOf('parse_error', null), null);
});

void test('an answer the proxy has no part in leaves the reputation as it was', (): void => {
  const read = after(attempt('success'));

  assert.equal(ProxyReputationEntity.fromAttempt(attempt('parse_error')), undefined);
  assert.equal(ProxyReputationEntity.fromAttempt(attempt('http_error', 1, 404), read), read);
});

void test('a proxy rests the longer the more failures in a row, up to a limit', (): void => {
  assert.equal(restMinutes(after(attempt('network_error')), 0), 2);
  assert.equal(restMinutes(after(attempt('network_error'), attempt('network_error', 1)), 1), 4);
  assert.equal(
    restMinutes(
      after(...Array.from({ length: 12 }, (_, index) => attempt('network_error', index))),
      11,
    ),
    120,
  );

  assert.equal(restMinutes(after(attempt('challenge_required')), 0), 60);
  assert.equal(
    restMinutes(after(attempt('http_error', 0, 401), attempt('http_error', 1, 403)), 1),
    120,
  );
  assert.equal(
    restMinutes(
      after(...Array.from({ length: 12 }, (_, index) => attempt('challenge_required', index))),
      11,
    ),
    24 * 60,
  );

  assert.equal(restMinutes(after(attempt('proxy_rejected')), 0), 6 * 60);
});

void test('a failure does not shorten a rest the proxy is in', (): void => {
  const reputation = after(attempt('challenge_required'), attempt('network_error', 1));

  assert.equal(restMinutes(reputation, 0), 60);
  assert.equal(reputation.snapshot.lastOutcome, 'unreachable');
  assert.equal(reputation.snapshot.failureStreak, 2);
});

void test('a read clears the failures in a row and the rest', (): void => {
  const reputation = after(attempt('challenge_required'), attempt('success', 1));

  assert.equal(reputation.snapshot.cooldownUntil, null);
  assert.equal(reputation.snapshot.failureStreak, 0);
  assert.equal(reputation.isCooling(new Date(startedAt.getTime() + 2 * minuteMs)), false);
  assert.equal(reputation.snapshot.successes, 1);
  assert.ok(reputation.snapshot.failures > 0.99);
});

void test('rests until the time it was given', (): void => {
  const reputation = after(attempt('network_error'));

  assert.equal(reputation.isCooling(new Date(startedAt.getTime() + minuteMs)), true);
  assert.equal(reputation.isCooling(new Date(startedAt.getTime() + 2 * minuteMs)), false);
});

void test('an attempt weighs half as much after the half-life', (): void => {
  const halfLifeMinutes = reputationHalfLifeMs / minuteMs;
  const reputation = after(attempt('success'), attempt('success', halfLifeMinutes));

  assert.equal(reputation.snapshot.successes, 1.5);
});

void test('an attempt reported late counts as of the last one', (): void => {
  const reputation = after(attempt('success', 10), attempt('success', 0));

  assert.equal(reputation.snapshot.successes, 2);
  assert.deepEqual(reputation.snapshot.lastAttemptAt, attempt('success', 10).attemptedAt);
});

void test('the chance to read rises with the reads, falls with the failures, and is the surer the more is known', (): void => {
  const unknown = ProxyReputationEntity.chanceOf(undefined, 1, startedAt);
  const proven = ProxyReputationEntity.chanceOf(
    after(attempt('success'), attempt('success'), attempt('success')),
    1,
    startedAt,
  );
  const failing = ProxyReputationEntity.chanceOf(
    after(attempt('network_error'), attempt('network_error'), attempt('network_error')),
    1,
    startedAt,
  );

  assert.ok(proven.mean > unknown.mean);
  assert.ok(failing.mean < unknown.mean);
  assert.ok(proven.deviation < unknown.deviation);
  assert.ok(
    ProxyReputationEntity.chanceOf(undefined, 0.25, startedAt).mean <
      ProxyReputationEntity.chanceOf(undefined, 1, startedAt).mean,
  );
});
