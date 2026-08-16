import type { ApiErrorBody } from '@badminton/contracts';

/**
 * Typed API client.
 *
 * Authentication travels in httpOnly cookies, so every request sets
 * `credentials: 'include'` and the browser handles the token. Nothing here ever reads or
 * stores a token — that is the whole point of the cookie design, and it means an XSS bug
 * in this app cannot exfiltrate a session.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:4000';

export const API_PREFIX = `${API_BASE_URL}/api/v1`;

/** An error carrying the API's structured body, so the UI can show the real reason. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiErrorBody['details'],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages keyed by path, for attaching errors to form inputs. */
  get fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const detail of this.details ?? []) {
      if (!errors[detail.path]) errors[detail.path] = detail.message;
    }
    return errors;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Return the raw response instead of parsed JSON, for file downloads. */
  raw?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refreshes the session, collapsing concurrent attempts into one request.
 *
 * Without this, a dashboard firing eight parallel queries on a stale access token would
 * send eight refreshes — and since refresh tokens rotate, the later ones would present
 * an already-rotated token and trip the reuse detection, logging the user out.
 */
async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(`${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so callers awaiting this promise all see the result.
      setTimeout(() => {
        refreshInFlight = null;
      }, 0);
    }
  })();

  return refreshInFlight;
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  return fetch(`${API_PREFIX}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);

  // One transparent retry after refreshing, so a merely-expired access token never
  // reaches the user as an error. Auth endpoints are excluded to avoid a refresh loop.
  if (response.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) response = await send(path, options);
  }

  if (options.raw) {
    if (!response.ok) throw await toApiError(response);
    return response as unknown as T;
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) throw await toApiError(response);

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // A non-JSON error (a proxy timeout page, for instance) still needs a useful message.
  }

  return new ApiError(
    response.status,
    body.code ?? 'REQUEST_FAILED',
    body.message ?? fallbackMessage(response.status),
    body.details,
    body.requestId,
  );
}

function fallbackMessage(status: number): string {
  if (status >= 500) return 'The server had a problem. Please try again.';
  if (status === 404) return 'That could not be found.';
  if (status === 429) return 'Too many requests. Please wait a moment.';
  return 'Something went wrong.';
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/** Builds a query string, dropping empty values so URLs stay readable and cacheable. */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Triggers a file download through the authenticated client.
 * A plain `<a href>` would not carry the session cookie cross-origin.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await apiRequest<Response>(path, { raw: true });
  const blob = await response.blob();

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? fallbackName;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
