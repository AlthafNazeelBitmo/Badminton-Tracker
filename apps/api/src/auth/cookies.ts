import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env';

export const ACCESS_TOKEN_COOKIE = 'bt_access';
export const REFRESH_TOKEN_COOKIE = 'bt_refresh';

/**
 * Cookie policy.
 *
 * - `httpOnly`: tokens are unreachable from JavaScript, so an XSS bug cannot exfiltrate
 *   a session.
 * - `sameSite: 'lax'`: blocks cross-site POSTs, which is the CSRF defence for a
 *   cookie-authenticated API. `strict` would break returning from an emailed link.
 * - `secure`: required in production; configurable so localhost over HTTP still works.
 * - The refresh cookie is scoped to the refresh endpoint's path, so it is not attached
 *   to ordinary API calls and has a much smaller exposure surface.
 */
export function accessCookieOptions(config: Env): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    domain: config.COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: config.ACCESS_TOKEN_TTL * 1000,
  };
}

export function refreshCookieOptions(config: Env): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    domain: config.COOKIE_DOMAIN || undefined,
    path: '/api/v1/auth',
    maxAge: config.REFRESH_TOKEN_TTL * 1000,
  };
}

export function setAuthCookies(
  response: Response,
  config: Env,
  tokens: { accessToken: string; refreshToken: string },
): void {
  response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, accessCookieOptions(config));
  response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, refreshCookieOptions(config));
}

export function clearAuthCookies(response: Response, config: Env): void {
  // Clearing must repeat the original attributes or the browser keeps the cookie.
  response.clearCookie(ACCESS_TOKEN_COOKIE, { ...accessCookieOptions(config), maxAge: undefined });
  response.clearCookie(REFRESH_TOKEN_COOKIE, {
    ...refreshCookieOptions(config),
    maxAge: undefined,
  });
}
