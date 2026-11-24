import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runWithin } from './run-within.type.js';

void test('returns the result when work finishes before the deadline', async (): Promise<void> => {
  let timedOut = false;
  const result = await runWithin(
    async (): Promise<string> => {
      await new Promise((resolve): void => {
        setTimeout(resolve, 10);
      });

      return 'ok';
    },
    new AbortController().signal,
    500,
    (): void => {
      timedOut = true;
    },
  );

  assert.equal(result, 'ok');
  assert.equal(timedOut, false);
});

void test('aborts the signal and rejects when work hangs past the deadline', async (): Promise<void> => {
  let aborted = false;
  let timedOut = false;

  await assert.rejects(
    runWithin(
      (_signal): Promise<void> => {
        _signal.addEventListener(
          'abort',
          (): void => {
            aborted = true;
          },
          { once: true },
        );

        // Intentionally never settles, simulating a wedged browser or socket call.
        return new Promise<void>((): void => {
          /* Pending forever. */
        });
      },
      new AbortController().signal,
      50,
      (): void => {
        timedOut = true;
      },
    ),
    /Job timed out after 50 ms/,
  );

  assert.equal(aborted, true);
  assert.equal(timedOut, true);
});
