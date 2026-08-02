/**
 * A caught value is `unknown`, and reaching for `.message` on it was the reason seven
 * catch blocks were typed `any`. Anything can be thrown, so anything is handled here
 * rather than at each call site.
 */
export function errorMessage(error: unknown, fallback = ''): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  const message = (error as { message?: unknown })?.message;
  if (typeof message === 'string' && message) return message;
  return fallback;
}
