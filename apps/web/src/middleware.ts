import { NextResponse, type NextRequest } from 'next/server';

/**
 * Forwards `/api/*` and `/health/*` to the API when it is a separate deployment (Vercel).
 *
 * The browser talks only to this app's origin, so the session cookies are first-party —
 * no cross-site cookie rules, no CORS preflight — and the API's address never reaches
 * the client. Unset `API_ORIGIN`, nothing is forwarded and `NEXT_PUBLIC_API_URL` points
 * at the API directly, as in local development.
 *
 * Done here rather than with a static rewrite so the visitor's address can go with the
 * request. Without it the API sees only this proxy's address, shared by every visitor,
 * and its per-address limits on sign-in would apply to all of them at once. The address
 * is vouched for with a secret both deployments hold; the API ignores it otherwise.
 */

const CLIENT_IP_HEADER = 'x-bt-client-ip';
const PROXY_SECRET_HEADER = 'x-bt-proxy-secret';

export function middleware(request: NextRequest): NextResponse {
  const origin = process.env.API_ORIGIN?.replace(/\/$/, '');
  if (!origin) return NextResponse.next();

  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, origin);

  const headers = new Headers(request.headers);
  // Whatever the browser sent under these names is discarded, never forwarded.
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_SECRET_HEADER);

  const secret = process.env.TRUSTED_PROXY_SECRET;
  const address = visitorAddress(request);
  if (secret && address) {
    headers.set(CLIENT_IP_HEADER, address);
    headers.set(PROXY_SECRET_HEADER, secret);
  }

  return NextResponse.rewrite(target, { request: { headers } });
}

/**
 * The visitor's address as the platform's edge saw it. Vercel sets both headers itself
 * and overwrites any value the client supplied.
 */
function visitorAddress(request: NextRequest): string | null {
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || null;
}

export const config = {
  matcher: ['/api/:path*', '/health/:path*'],
};
