import assert from 'node:assert/strict';
import { test } from 'node:test';

import { errorMessage } from './error-message.parser.js';

void test('formats Error messages with optional Error cause and falls back for non-Errors', (): void => {
  assert.equal(errorMessage(new Error('timeout')), 'timeout');
  assert.equal(
    errorMessage(new Error('fetch failed', { cause: new Error('ECONNREFUSED') })),
    'fetch failed: ECONNREFUSED',
  );
  assert.equal(
    errorMessage(new Error('fetch failed: ECONNREFUSED', { cause: new Error('ECONNREFUSED') })),
    'fetch failed: ECONNREFUSED',
  );
  assert.equal(errorMessage('boom'), 'unknown error');
});
