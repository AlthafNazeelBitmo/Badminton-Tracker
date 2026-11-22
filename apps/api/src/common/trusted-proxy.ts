import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { NextFunction, Request, Response } from 'express';

/**
 * Recovers the caller's address when requests arrive through the web app's proxy.
 *
 * On Vercel the web app forwards `/api/*` to this API as a separate deployment, and the
 * API then sees the proxy's address — one of a handful shared by every visitor. Rate
 * limits on the anonymous auth routes are keyed by address, so without this one person
 * failing to sign in a few times would lock everyone else out.
 *
 * The proxy therefore sends the address it saw in `x-bt-client-ip`, together with a
 * secret shared by the two deployments. Only when the secret matches is the address
 * believed — it is written into `X-Forwarded-For`, where Express's `request.ip` (with
 * `trust proxy` set to one hop) picks it up for the limiter and the audit log alike.
 * Anything else has the header removed, so a caller cannot choose its own address.
 */
export const CLIENT_IP_HEADER = 'x-bt-client-ip';
export const PROXY_SECRET_HEADER = 'x-bt-proxy-secret';

export function trustedProxyMiddleware(secret: string | undefined) {
  const expected = secret ? digest(secret) : null;

  return (request: Request, _response: Response, next: NextFunction): void => {
    const presented = request.headers[PROXY_SECRET_HEADER];
    const claimed = request.headers[CLIENT_IP_HEADER];
    delete request.headers[PROXY_SECRET_HEADER];
    delete request.headers[CLIENT_IP_HEADER];

    if (
      expected &&
      typeof presented === 'string' &&
      typeof claimed === 'string' &&
      isIP(claimed) !== 0 &&
      timingSafeEqual(digest(presented), expected)
    ) {
      request.headers['x-forwarded-for'] = claimed;
    }

    next();
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
