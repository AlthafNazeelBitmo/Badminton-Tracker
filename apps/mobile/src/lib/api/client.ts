import { CLIENT_KIND_HEADER, IDEMPOTENCY_KEY_HEADER } from './headers';
import { ApiError, CancelledError, NetworkError } from './errors';
import { config } from '../config';
import { clearTokens, readTokens, saveTokens, type StoredTokens } from '../storage/secure-tokens';

/**
 * The HTTP client.
 *
 * Everything the app sends to the server goes through here, so this is the one place
 * that has to get four things right: attaching the session, refreshing it when it
 * expires, turning failures into the three error kinds the rest of the app reasons
 * about, and never leaving a request hanging forever.
 */

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Marks the request as safely retryable. Only meaningful on writes. */
  idempotencyKey?: string;
  /** Skips the session header, for sign-in and registration. */
  anonymous?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Long enough for a slow mobile connection, short enough that a dead link is noticed. */
const DEFAULT_TIMEOUT_MS = 20_000;

type SessionListener = (state: 'signed-out') => void;

const listeners = new Set<SessionListener>();

/**
 * Notifies the app when the session ends for a reason the user did not choose — the
 * refresh token was revoked, expired, or reused elsewhere. The UI redirects to sign-in;
 * without this the app would sit there failing every request.
 */
export function onSessionLost(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announceSessionLost(): void {
  for (const listener of listeners) listener('signed-out');
}

/**
 * The in-flight refresh, if any.
 *
 * When an access token expires, every screen's request fails at once. Without this, each
 * one would start its own refresh, and since refresh tokens rotate and a reused token
 * revokes the whole family, the second refresh to arrive would log the user out. So the
 * first caller refreshes and the rest wait on the same promise.
 */
let refreshInFlight: Promise<StoredTokens | null> | null = null;

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { anonymous = false } = options;

  const response = await send(path, options, anonymous ? null : await readTokens());

  // 401 on an authenticated request means the access token aged out. Refresh once and
  // replay; if the refresh itself fails the session is genuinely over.
  if (response.status === 401 && !anonymous) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      announceSessionLost();
      throw await toApiError(response);
    }

    const retried = await send(path, options, refreshed);
    return parse<T>(retried);
  }

  return parse<T>(response);
}

async function send(
  path: string,
  options: RequestOptions,
  tokens: StoredTokens | null,
): Promise<Response> {
  const { method = 'GET', body, query, idempotencyKey, signal, timeoutMs } = options;

  const url = new URL(`${config.apiUrl}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    // Tells the API this is a native client, so it returns tokens in the response body
    // rather than relying on cookies the app has no way to hold.
    [CLIENT_KIND_HEADER]: 'native',
  };

  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
  if (idempotencyKey) headers[IDEMPOTENCY_KEY_HEADER] = idempotencyKey;

  // A request with no timeout can hang indefinitely on a captive portal — the sort of
  // network that accepts a connection and then never answers. That would stall the sync
  // queue behind it forever.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const abort = mergeSignals(signal, timeout.signal);

  try {
    return await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort,
    });
  } catch (error) {
    // The caller's own signal firing is a cancellation; anything else is the network.
    if (signal?.aborted) throw new CancelledError();
    if (timeout.signal.aborted) throw new NetworkError('The request timed out.');
    throw new NetworkError('Could not reach the server.', error);
  } finally {
    clearTimeout(timer);
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;

  try {
    return (await response.json()) as T;
  } catch (error) {
    // A 2xx that is not JSON means something between here and the API rewrote the
    // response — a captive portal login page is the usual culprit.
    throw new NetworkError('The server sent a response the app could not read.', error);
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = 'UNKNOWN';
  let message = `Request failed with status ${response.status}.`;
  let details: Array<{ path?: string; message: string }> | undefined;
  let requestId: string | undefined;

  try {
    const body = (await response.json()) as {
      code?: string;
      message?: string;
      details?: Array<{ path?: string; message: string }>;
      requestId?: string;
    };
    code = body.code ?? code;
    message = body.message ?? message;
    details = body.details;
    requestId = body.requestId;
  } catch {
    // A non-JSON error body is normal from a proxy or load balancer. The status code is
    // the part that matters, and it is already captured.
  }

  return new ApiError(response.status, code, message, details, requestId);
}

/**
 * Exchanges the refresh token for a new session, once, however many callers ask.
 */
async function refreshSession(): Promise<StoredTokens | null> {
  refreshInFlight ??= (async () => {
    try {
      const current = await readTokens();
      if (!current) return null;

      const response = await fetch(`${config.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          [CLIENT_KIND_HEADER]: 'native',
          'X-Refresh-Token': current.refreshToken,
        },
      });

      if (!response.ok) {
        // The refresh token is spent, revoked, or was reused elsewhere. Clearing here
        // rather than leaving it means the next launch shows sign-in instead of
        // retrying a token that will never work again.
        await clearTokens();
        return null;
      }

      const session = (await response.json()) as { tokens?: StoredTokens };
      if (!session.tokens) {
        await clearTokens();
        return null;
      }

      await saveTokens(session.tokens);
      return session.tokens;
    } catch {
      // A network failure during refresh is not proof the session is invalid, so the
      // tokens are kept and the caller simply fails this once.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Combines the caller's cancellation signal with the timeout's.
 *
 * `AbortSignal.any` exists in newer runtimes but not reliably in Hermes, so this is
 * done by hand rather than assumed.
 */
function mergeSignals(caller: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!caller) return timeout;
  if (caller.aborted) return caller;

  const controller = new AbortController();
  const forward = () => controller.abort();
  caller.addEventListener('abort', forward, { once: true });
  timeout.addEventListener('abort', forward, { once: true });
  return controller.signal;
}

/** Test seam: resets the single-flight refresh between cases. */
export function __resetClientState(): void {
  refreshInFlight = null;
  listeners.clear();
}
