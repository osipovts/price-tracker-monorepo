/** The message of an error for a log line, including its cause when present. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error';

  const cause = error.cause instanceof Error ? error.cause.message : '';

  return cause !== '' && !error.message.includes(cause)
    ? `${error.message}: ${cause}`
    : error.message;
}
