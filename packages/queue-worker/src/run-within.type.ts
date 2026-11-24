/**
 * Runs `work` with an AbortSignal that aborts after `deadlineMs`, and rejects if `work` does not
 * settle in time even when it ignores the signal.
 */
export async function runWithin<ResultType>(
  work: (signal: AbortSignal) => Promise<ResultType>,
  parentSignal: AbortSignal,
  deadlineMs: number,
  onTimeout?: () => void,
): Promise<ResultType> {
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject): void => {
    timer = setTimeout((): void => {
      const error = new Error(`Job timed out after ${String(deadlineMs)} ms`);
      controller.abort(error);
      onTimeout?.();
      reject(error);
    }, deadlineMs);
  });

  const running = work(signal);
  // Prevent an unhandled rejection if `work` rejects after the timeout already won the race.
  running.catch((): void => {
    /* Handled by the caller when `running` wins, ignored after timeout. */
  });

  try {
    return await Promise.race([running, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
