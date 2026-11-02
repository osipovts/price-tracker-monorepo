import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findLastGroupCheck } from './group-checks.type.js';

void test('takes the newest read of the products, with the marketplace it was on', (): void => {
  assert.deepEqual(
    findLastGroupCheck([
      { marketplace: 'ozon', lastCheckedAt: new Date('2026-11-03T11:00:00Z') },
      { marketplace: 'dns', lastCheckedAt: new Date('2026-11-03T11:30:00Z') },
      { marketplace: 'ozon', lastCheckedAt: null },
    ]),
    { marketplace: 'dns', checkedAt: new Date('2026-11-03T11:30:00Z') },
  );
});

void test('is none while no product was read, or the group has none', (): void => {
  assert.equal(findLastGroupCheck([{ marketplace: 'ozon', lastCheckedAt: null }]), null);
  assert.equal(findLastGroupCheck([]), null);
});
