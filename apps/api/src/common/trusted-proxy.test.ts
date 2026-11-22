import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER, trustedProxyMiddleware } from './trusted-proxy';

/**
 * The address a request is believed to come from decides whose sign-in budget it spends.
 * Getting this wrong either way is a real failure: believe anyone, and an attacker picks
 * a fresh address per guess; believe no one, and every web visitor shares one budget.
 */

const SECRET = 'proxy-secret-for-tests-0123456789abcdef';

function run(secret: string | undefined, headers: Record<string, string>): Request['headers'] {
  const request = {
    headers: { 'x-forwarded-for': '76.76.21.9', ...headers },
  } as unknown as Request;
  trustedProxyMiddleware(secret)(request, {} as Response, () => undefined);
  return request.headers;
}

describe('trustedProxyMiddleware', () => {
  it("believes the proxy's word for the visitor's address", () => {
    const headers = run(SECRET, {
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [PROXY_SECRET_HEADER]: SECRET,
    });
    expect(headers['x-forwarded-for']).toBe('203.0.113.7');
  });

  it('ignores an address vouched for with the wrong secret', () => {
    const headers = run(SECRET, {
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [PROXY_SECRET_HEADER]: 'guess',
    });
    expect(headers['x-forwarded-for']).toBe('76.76.21.9');
  });

  it('ignores an address with no secret at all', () => {
    const headers = run(SECRET, { [CLIENT_IP_HEADER]: '203.0.113.7' });
    expect(headers['x-forwarded-for']).toBe('76.76.21.9');
  });

  it('believes nothing when no secret is configured', () => {
    const headers = run(undefined, {
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [PROXY_SECRET_HEADER]: '',
    });
    expect(headers['x-forwarded-for']).toBe('76.76.21.9');
  });

  it('refuses something that is not an address', () => {
    const headers = run(SECRET, {
      [CLIENT_IP_HEADER]: '1.2.3.4, 5.6.7.8',
      [PROXY_SECRET_HEADER]: SECRET,
    });
    expect(headers['x-forwarded-for']).toBe('76.76.21.9');
  });

  it('never passes the secret further into the application', () => {
    const headers = run(SECRET, {
      [CLIENT_IP_HEADER]: '203.0.113.7',
      [PROXY_SECRET_HEADER]: SECRET,
    });
    expect(headers[PROXY_SECRET_HEADER]).toBeUndefined();
    expect(headers[CLIENT_IP_HEADER]).toBeUndefined();
  });
});
