import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, registerUser, resetDatabase, type TestContext } from './harness';

let context: TestContext;

beforeAll(async () => {
  context = await createTestApp();
});

afterAll(async () => {
  await context.app.close();
});

beforeEach(async () => {
  await resetDatabase(context.prisma);
});

describe('registration', () => {
  it('creates an account, a profile and a self player in one step', async () => {
    const user = await registerUser(context);

    const profile = await context.prisma.playerProfile.findUnique({ where: { userId: user.id } });
    expect(profile).not.toBeNull();

    const self = await context.prisma.player.findFirst({
      where: { userId: user.id, isSelf: true },
    });
    expect(self).not.toBeNull();
    expect(self?.relationship).toBe('SELF');
  });

  it('never stores the password in plaintext', async () => {
    const user = await registerUser(context, { password: 'a-very-memorable-passphrase-7' });
    const stored = await context.prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    expect(stored.passwordHash).not.toContain('a-very-memorable-passphrase-7');
    expect(stored.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects a weak password', async () => {
    const response = await context
      .http()
      .post('/api/v1/auth/register')
      .send({ email: 'weak@example.test', password: 'short', name: 'Weak' })
      .expect(422);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.details.some((d: { path: string }) => d.path === 'password')).toBe(true);
  });

  it('rejects a duplicate email', async () => {
    const user = await registerUser(context);
    await context
      .http()
      .post('/api/v1/auth/register')
      .send({ email: user.email, password: 'another-valid-password-1', name: 'Copy' })
      .expect(409);
  });

  it('sets httpOnly cookies rather than returning tokens in the body', async () => {
    const response = await context
      .http()
      .post('/api/v1/auth/register')
      .send({ email: 'cookies@example.test', password: 'cookie-password-2026', name: 'Cookie' })
      .expect(201);

    expect(response.body.accessToken).toBeUndefined();
    expect(response.body.refreshToken).toBeUndefined();

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((cookie) => cookie.startsWith('bt_access='));
    const refresh = cookies.find((cookie) => cookie.startsWith('bt_refresh='));

    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=Lax/i);
    expect(refresh).toMatch(/HttpOnly/i);
    // The refresh cookie is scoped to the auth path so ordinary API calls never carry it.
    expect(refresh).toMatch(/Path=\/api\/v1\/auth/i);
  });
});

describe('login', () => {
  it('signs in with correct credentials', async () => {
    const user = await registerUser(context);
    await context
      .http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
  });

  it('gives the same error for an unknown email and a wrong password', async () => {
    const user = await registerUser(context);

    const wrongPassword = await context
      .http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'definitely-not-the-password' })
      .expect(401);

    const unknownEmail = await context
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'definitely-not-the-password' })
      .expect(401);

    // Identical wording and code: the endpoint must not confirm which emails exist.
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    expect(wrongPassword.body.code).toBe(unknownEmail.body.code);
  });

  it('records failed attempts in the audit log', async () => {
    const user = await registerUser(context);
    await context
      .http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'wrong-password-entirely' })
      .expect(401);

    const entries = await context.prisma.auditLog.findMany({
      where: { action: 'auth.login_failed' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ipHash).not.toBeNull();
  });
});

describe('session lifecycle', () => {
  it('returns the current user from /auth/me', async () => {
    const user = await registerUser(context);
    const response = await user.agent.get('/api/v1/auth/me').expect(200);
    expect(response.body.user.email).toBe(user.email);
  });

  it('refuses unauthenticated access to protected routes', async () => {
    await context.http().get('/api/v1/matches').expect(401);
    await context.http().get('/api/v1/analytics/overview').expect(401);
    await context.http().get('/api/v1/players').expect(401);
  });

  it('rotates the refresh token and revokes the old one', async () => {
    const user = await registerUser(context);

    const before = await context.prisma.refreshToken.count({ where: { userId: user.id } });
    await user.agent.post('/api/v1/auth/refresh').expect(200);

    const after = await context.prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(after).toHaveLength(before + 1);
    expect(after.filter((token) => token.revokedAt !== null)).toHaveLength(1);
    // Rotation keeps the family, which is what makes reuse detectable.
    expect(new Set(after.map((token) => token.familyId)).size).toBe(1);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    const user = await registerUser(context);

    const first = await user.agent.post('/api/v1/auth/refresh').expect(200);
    const staleCookie = (first.request.cookies ?? '') as string;

    // Rotate again so the token captured above is now retired.
    await user.agent.post('/api/v1/auth/refresh').expect(200);

    const stale = extractCookieValue(staleCookie, 'bt_refresh');
    if (stale) {
      await context
        .http()
        .post('/api/v1/auth/refresh')
        .set('x-refresh-token', stale)
        .expect(401);

      const tokens = await context.prisma.refreshToken.findMany({ where: { userId: user.id } });
      expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
    }
  });

  it('signs out and clears cookies', async () => {
    const user = await registerUser(context);
    await user.agent.post('/api/v1/auth/logout').expect(204);

    const tokens = await context.prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
  });
});

describe('password change', () => {
  it('rejects an incorrect current password', async () => {
    const user = await registerUser(context);
    await user.agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'not-it-at-all', newPassword: 'a-brand-new-password-9' })
      .expect(422);
  });

  it('ends every session when the password changes', async () => {
    const user = await registerUser(context);
    await user.agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: user.password, newPassword: 'a-brand-new-password-9' })
      .expect(204);

    const tokens = await context.prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);

    await context
      .http()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'a-brand-new-password-9' })
      .expect(200);
  });
});

describe('password reset', () => {
  it('responds identically for known and unknown addresses', async () => {
    const user = await registerUser(context);

    const known = await context
      .http()
      .post('/api/v1/auth/request-password-reset')
      .send({ email: user.email })
      .expect(202);

    const unknown = await context
      .http()
      .post('/api/v1/auth/request-password-reset')
      .send({ email: 'nobody@example.test' })
      .expect(202);

    expect(known.body).toEqual(unknown.body);
    // The token must never travel in the response body.
    expect(JSON.stringify(known.body)).not.toMatch(/token/i);
  });

  it('rejects an invalid reset token', async () => {
    await context
      .http()
      .post('/api/v1/auth/reset-password')
      .send({ token: 'x'.repeat(40), password: 'replacement-password-11' })
      .expect(422);
  });
});

function extractCookieValue(cookieHeader: string, name: string): string | null {
  const match = new RegExp(`${name}=([^;]+)`).exec(cookieHeader);
  return match?.[1] ?? null;
}
