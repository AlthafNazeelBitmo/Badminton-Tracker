/**
 * The three ways a request can fail, kept distinct because the app responds to each
 * differently and conflating them produces the worst bugs in an offline app.
 *
 * A queued match that failed because the phone was in a basement must be retried
 * forever. The same match rejected because its score is impossible must never be retried
 * — it will be rejected identically every time, and a queue that keeps trying is a queue
 * that never drains. Getting this distinction wrong is how offline apps end up either
 * losing data or hammering a server with a request that cannot succeed.
 */

/** The request never reached the server, or the reply never came back. Always retryable. */
export class NetworkError extends Error {
  readonly kind = 'network' as const;

  constructor(
    message = 'Could not reach the server.',
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The server answered, and the answer was an error. */
export class ApiError extends Error {
  readonly kind = 'api' as const;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Array<{ path?: string; message: string }>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * Whether retrying this request could ever produce a different answer.
   *
   * 4xx means the request itself is wrong: the same bytes will be rejected the same way
   * for as long as the server behaves consistently. The exceptions are the two codes that
   * describe a temporary condition rather than a bad request — 408 and 429 — and 409,
   * which the idempotency layer returns for a key collision the client can resolve.
   */
  get retryable(): boolean {
    if (this.status >= 500) return true;
    return this.status === 408 || this.status === 429;
  }

  /** The session is gone; the app has to sign in again rather than retry. */
  get requiresReauthentication(): boolean {
    return this.status === 401;
  }
}

/** The request was abandoned — a timeout, or the screen that wanted it went away. */
export class CancelledError extends Error {
  readonly kind = 'cancelled' as const;

  constructor(message = 'The request was cancelled.') {
    super(message);
    this.name = 'CancelledError';
  }
}

export type RequestFailure = NetworkError | ApiError | CancelledError;

/**
 * Whether a failure is worth queueing for a later retry.
 *
 * Used by the outbox to decide between "keep this and try again" and "this will never
 * work, surface it to the user".
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (error instanceof ApiError) return error.retryable;
  return false;
}

/** A message worth showing a person, as opposed to a stack trace. */
export function describeError(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'No connection. Your changes are saved on this device and will sync when you are back online.';
  }
  if (error instanceof ApiError) return error.message;
  if (error instanceof CancelledError) return 'The request was cancelled.';
  return 'Something went wrong.';
}
