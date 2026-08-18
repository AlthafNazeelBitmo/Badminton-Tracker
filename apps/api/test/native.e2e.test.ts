import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_KEY_HEADER, type SyncPullResponse } from '@badminton/contracts';
import {
  createTestApp,
  recordMatch,
  registerUser,
  resetDatabase,
  type TestContext,
} from './harness';

/**
 * The surface the mobile app depends on: token delivery for native clients, safe replay
 * of queued writes, device registration, and delta sync.
 *
 * These are the behaviours that break silently. A duplicated match after a flaky
 * connection looks like a data-entry mistake, not a bug, so it is exactly the kind of
 * thing that has to be proven rather than assumed.
 */
describe('native client support', () => {
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

  const matchBody = {
    discipline: 'SINGLES' as const,
    session: { date: '2026-08-01', sessionType: 'CASUAL' as const },
    partners: [],
    opponents: [{ name: 'Idempotent Opponent' }],
    games: [
      { myScore: 21, opponentScore: 15 },
      { myScore: 21, opponentScore: 12 },
    ],
  };

  describe('token delivery', () => {
    it('returns tokens in the body for a native client and never for a browser', async () => {
      const email = `native-${Date.now()}@example.test`;
      const password = 'integration-test-password-1';

      const native = await context
        .http()
        .post('/api/v1/auth/register')
        .set('X-Client-Kind', 'native')
        .send({ email, password, name: 'Native Player', timeZone: 'Asia/Kolkata' })
        .expect(201);

      // A native app has no cookie jar worth trusting, so it needs the tokens themselves
      // to put in the Keychain / Keystore.
      expect(native.body.tokens.accessToken).toEqual(expect.any(String));
      expect(native.body.tokens.refreshToken).toEqual(expect.any(String));

      const browser = await context
        .http()
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);

      // A browser must not receive them: anything reachable from JavaScript is reachable
      // from an XSS payload, which is the whole reason the cookies are httpOnly.
      expect(browser.body.tokens).toBeUndefined();
      const cookies = browser.headers['set-cookie'] as unknown as string[];
      expect(cookies.join(';')).toContain('HttpOnly');
    });

    it('authenticates a native client from the bearer token alone', async () => {
      const registration = await context
        .http()
        .post('/api/v1/auth/register')
        .set('X-Client-Kind', 'native')
        .send({
          email: `bearer-${Date.now()}@example.test`,
          password: 'integration-test-password-1',
          name: 'Bearer Player',
          timeZone: 'UTC',
        })
        .expect(201);

      // Deliberately a fresh agent: no cookies, exactly like a phone.
      await context
        .http()
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${registration.body.tokens.accessToken}`)
        .expect(200);
    });

    it('rotates a refresh token supplied by header by a native client', async () => {
      const registration = await context
        .http()
        .post('/api/v1/auth/register')
        .set('X-Client-Kind', 'native')
        .send({
          email: `refresh-${Date.now()}@example.test`,
          password: 'integration-test-password-1',
          name: 'Refresh Player',
          timeZone: 'UTC',
        })
        .expect(201);

      const refreshed = await context
        .http()
        .post('/api/v1/auth/refresh')
        .set('X-Client-Kind', 'native')
        .set('X-Refresh-Token', registration.body.tokens.refreshToken)
        .expect(200);

      expect(refreshed.body.tokens.refreshToken).not.toEqual(registration.body.tokens.refreshToken);

      // The old token is dead the moment it is exchanged, so a stolen copy is worth
      // nothing once the real device has refreshed.
      await context
        .http()
        .post('/api/v1/auth/refresh')
        .set('X-Client-Kind', 'native')
        .set('X-Refresh-Token', registration.body.tokens.refreshToken)
        .expect(401);
    });
  });

  describe('idempotent writes', () => {
    it('replays the original response instead of creating a second match', async () => {
      const user = await registerUser(context);
      const key = 'outbox-01HZX9YQ7K3M4N5P6Q7R8S9T';

      const first = await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(matchBody)
        .expect(201);

      const replay = await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(matchBody)
        .expect(201);

      expect(replay.headers['idempotency-replayed']).toBe('true');
      expect(replay.body.id).toBe(first.body.id);
      expect(replay.body).toEqual(first.body);

      const matches = await user.agent.get('/api/v1/matches').expect(200);
      expect(matches.body.items).toHaveLength(1);
    });

    it('replays even when the retry serialises the same fields in a different order', async () => {
      const user = await registerUser(context);
      const key = 'outbox-reordered-key-000000001';

      const first = await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(matchBody)
        .expect(201);

      const reordered = {
        games: matchBody.games,
        opponents: matchBody.opponents,
        session: { sessionType: matchBody.session.sessionType, date: matchBody.session.date },
        partners: matchBody.partners,
        discipline: matchBody.discipline,
      };

      const replay = await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(reordered)
        .expect(201);

      expect(replay.body.id).toBe(first.body.id);
    });

    it('rejects the same key used for a genuinely different request', async () => {
      const user = await registerUser(context);
      const key = 'outbox-reused-key-00000000001';

      await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(matchBody)
        .expect(201);

      // Different scores under the same key: the client has a bug, and answering with the
      // stored response would quietly discard a real match.
      const conflict = await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send({ ...matchBody, games: [{ myScore: 21, opponentScore: 19 }] })
        .expect(409);

      expect(conflict.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('scopes keys per user so one account cannot replay another’s response', async () => {
      const first = await registerUser(context);
      const second = await registerUser(context);
      const key = 'outbox-shared-key-00000000001';

      const created = await first.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(matchBody)
        .expect(201);

      const other = await second.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(matchBody)
        .expect(201);

      expect(other.headers['idempotency-replayed']).toBeUndefined();
      expect(other.body.id).not.toBe(created.body.id);
    });

    it('lets a genuine retry succeed after a rejected request', async () => {
      const user = await registerUser(context);
      const key = 'outbox-after-failure-000000001';

      // A game to 3 is not a valid badminton score, so nothing is stored against the key.
      await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send({ ...matchBody, games: [{ myScore: 3, opponentScore: 1 }] })
        .expect(422);

      // The client fixes the entry and retries with the same key; it must not be told the
      // key is already used.
      await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(matchBody)
        .expect(201);
    });

    it('rejects a malformed key rather than ignoring it', async () => {
      const user = await registerUser(context);

      const response = await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, 'short')
        .send(matchBody)
        .expect(400);

      expect(response.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    });

    it('creates normally when no key is sent, so the web client is unaffected', async () => {
      const user = await registerUser(context);

      await user.agent.post('/api/v1/matches').send(matchBody).expect(201);
      await user.agent.post('/api/v1/matches').send(matchBody).expect(201);

      const matches = await user.agent.get('/api/v1/matches').expect(200);
      expect(matches.body.items).toHaveLength(2);
    });
  });

  describe('devices', () => {
    const device = {
      installationId: 'installation-aaaaaaaaaaaaaaaa',
      platform: 'IOS' as const,
      pushToken: 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]',
      appVersion: '1.0.0',
      osVersion: '18.2',
      deviceName: 'iPhone',
      locale: 'en-IN',
      timeZone: 'Asia/Kolkata',
    };

    it('registers once per installation however often the app launches', async () => {
      const user = await registerUser(context);

      const first = await user.agent.post('/api/v1/devices').send(device).expect(200);
      const second = await user.agent
        .post('/api/v1/devices')
        .send({ ...device, appVersion: '1.1.0' })
        .expect(200);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.appVersion).toBe('1.1.0');

      const list = await user.agent.get('/api/v1/devices').expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('reports whether push is enabled without echoing the token back', async () => {
      const user = await registerUser(context);

      const registered = await user.agent.post('/api/v1/devices').send(device).expect(200);
      expect(registered.body.pushEnabled).toBe(true);
      expect(JSON.stringify(registered.body)).not.toContain(device.pushToken);

      const withoutPush = await user.agent
        .post('/api/v1/devices')
        .send({ ...device, pushToken: null })
        .expect(200);
      expect(withoutPush.body.pushEnabled).toBe(false);
    });

    it('moves a push token to the device that now holds it', async () => {
      const first = await registerUser(context);
      const second = await registerUser(context);

      await first.agent.post('/api/v1/devices').send(device).expect(200);
      // The same handset, signed in to a different account. The operating system hands
      // the token to whoever installed the app, so the previous claim has to be released
      // or the old account keeps receiving this phone's notifications.
      await second.agent
        .post('/api/v1/devices')
        .send({ ...device, installationId: 'installation-bbbbbbbbbbbbbbbb' })
        .expect(200);

      const firstDevices = await first.agent.get('/api/v1/devices').expect(200);
      expect(firstDevices.body[0].pushEnabled).toBe(false);

      const secondDevices = await second.agent.get('/api/v1/devices').expect(200);
      expect(secondDevices.body[0].pushEnabled).toBe(true);
    });

    it('marks which entry is the calling device', async () => {
      const user = await registerUser(context);

      const thisPhone = await user.agent.post('/api/v1/devices').send(device).expect(200);
      await user.agent
        .post('/api/v1/devices')
        .send({ ...device, installationId: 'installation-cccccccccccccccc', pushToken: null })
        .expect(200);

      const list = await user.agent
        .get('/api/v1/devices')
        .query({ installationId: device.installationId })
        .expect(200);

      expect(list.body).toHaveLength(2);
      const current = list.body.filter((entry: { isCurrent: boolean }) => entry.isCurrent);
      expect(current).toHaveLength(1);
      // The installation id itself is never echoed back, so identity is checked by id.
      expect(current[0].id).toBe(thisPhone.body.id);
    });

    it('hides another user’s device behind a 404 rather than a 403', async () => {
      const owner = await registerUser(context);
      const stranger = await registerUser(context);

      const registered = await owner.agent.post('/api/v1/devices').send(device).expect(200);

      // 403 would confirm the id exists. 404 tells a stranger nothing.
      await stranger.agent.delete(`/api/v1/devices/${registered.body.id}`).expect(404);
      await owner.agent.delete(`/api/v1/devices/${registered.body.id}`).expect(204);
    });
  });

  describe('delta sync', () => {
    it('returns everything on a first pull and nothing on an immediate second', async () => {
      const user = await registerUser(context);
      await recordMatch(user);

      const first = await user.agent.get('/api/v1/sync/pull').expect(200);
      expect(first.body.changed.matches).toHaveLength(1);
      expect(first.body.counts.matches).toBe(1);
      expect(first.body.hasMore).toBe(false);

      const second = await user.agent
        .get('/api/v1/sync/pull')
        .query({ since: first.body.syncedAt })
        .expect(200);

      expect(second.body.changed.matches).toHaveLength(0);
      expect(second.body.changed.players).toHaveLength(0);
    });

    it('returns only what changed after the cursor', async () => {
      const user = await registerUser(context);
      await recordMatch(user);

      const first = await user.agent.get('/api/v1/sync/pull').expect(200);
      await recordMatch(user, { opponents: [{ name: 'Second Opponent' }] });

      const second = await user.agent
        .get('/api/v1/sync/pull')
        .query({ since: first.body.syncedAt })
        .expect(200);

      expect(second.body.changed.matches).toHaveLength(1);
      expect(second.body.counts.matches).toBe(2);
      expect(second.body.changed.players.map((p: { name: string }) => p.name)).toContain(
        'Second Opponent',
      );
    });

    it('carries participant names on the match so a cold cache can render it', async () => {
      const user = await registerUser(context);
      await recordMatch(user, {
        discipline: 'DOUBLES',
        partners: [{ name: 'Priya' }],
        opponents: [{ name: 'Arun' }, { name: 'Meera' }],
      });

      const pull = await user.agent.get('/api/v1/sync/pull').expect(200);
      const [match] = pull.body.changed.matches;

      expect(match.partnerNames).toEqual(['Priya']);
      expect(match.opponentNames.sort()).toEqual(['Arun', 'Meera']);
      expect(match.derived.result).toBe('WIN');
    });

    it('pages, and every page is reachable by following the cursor', async () => {
      const user = await registerUser(context);
      for (let index = 0; index < 3; index += 1) {
        await recordMatch(user, { opponents: [{ name: `Opponent ${index}` }] });
      }

      const { seen, pages } = await drain(user, 1);

      expect(seen.size).toBe(3);
      // One page per match plus the page that reports the run is finished.
      expect(pages).toBeLessThanOrEqual(5);
    });

    it('pages through records that share an updatedAt instead of looping on them', async () => {
      const user = await registerUser(context);
      for (let index = 0; index < 4; index += 1) {
        await recordMatch(user, { opponents: [{ name: `Tied ${index}` }] });
      }

      // A bulk write — a CSV import, or a migration — stamps every row with the same
      // timestamp. A cursor made only of timestamps either returns these forever or steps
      // straight over them, so this is the case that decides whether paging is correct.
      await context.prisma.match.updateMany({
        where: { userId: user.id },
        data: { updatedAt: new Date('2026-08-02T10:00:00.000Z') },
      });

      // Guard the premise: if Prisma ever stamped its own timestamp here the rows would
      // no longer be tied and this test would quietly stop testing anything.
      const stamps = await context.prisma.match.findMany({
        where: { userId: user.id },
        select: { updatedAt: true },
      });
      expect(new Set(stamps.map((row) => row.updatedAt.getTime())).size).toBe(1);

      const { seen } = await drain(user, 2);
      expect(seen.size).toBe(4);
    });

    it('reports the same syncedAt on every page of a run', async () => {
      const user = await registerUser(context);
      for (let index = 0; index < 3; index += 1) {
        await recordMatch(user, { opponents: [{ name: `Stamped ${index}` }] });
      }

      const { syncedAtValues } = await drain(user, 1);

      // The client stores this when the run completes. If it drifted forward mid-run,
      // anything written while the run was in flight would never be pulled.
      expect(new Set(syncedAtValues).size).toBe(1);
    });

    /** Follows the cursor to exhaustion, with a hard bound so a stuck cursor fails fast. */
    async function drain(
      user: Awaited<ReturnType<typeof registerUser>>,
      limit: number,
    ): Promise<{ seen: Set<string>; pages: number; syncedAtValues: string[] }> {
      const seen = new Set<string>();
      const syncedAtValues: string[] = [];
      let cursor: string | null = null;

      for (let pages = 1; pages <= 20; pages += 1) {
        const response: { body: SyncPullResponse } = await user.agent
          .get('/api/v1/sync/pull')
          .query({ limit, ...(cursor ? { cursor } : {}) })
          .expect(200);

        for (const match of response.body.changed.matches) seen.add(match.id);
        syncedAtValues.push(response.body.syncedAt);

        if (!response.body.hasMore) return { seen, pages, syncedAtValues };
        cursor = response.body.cursor;
        expect(cursor).toEqual(expect.any(String));
      }

      throw new Error('Sync cursor never reported completion.');
    }

    it('never returns another user’s records', async () => {
      const owner = await registerUser(context);
      const stranger = await registerUser(context);
      await recordMatch(owner);

      const pull = await stranger.agent.get('/api/v1/sync/pull').expect(200);
      expect(pull.body.changed.matches).toHaveLength(0);
      expect(pull.body.counts.matches).toBe(0);
    });

    it('exposes totals that let a client detect a deletion made elsewhere', async () => {
      const user = await registerUser(context);
      const match = await recordMatch(user);

      const before = await user.agent.get('/api/v1/sync/status').expect(200);
      expect(before.body.totals.matches).toBe(1);
      expect(before.body.lastMatchAt).toEqual(expect.any(String));

      await user.agent.delete(`/api/v1/matches/${match.id}`).expect(204);

      const after = await user.agent.get('/api/v1/sync/status').expect(200);
      expect(after.body.totals.matches).toBe(0);
      expect(after.body.lastMatchAt).toBeNull();
    });

    it('rejects a starting point that is not a timestamp', async () => {
      const user = await registerUser(context);
      await user.agent.get('/api/v1/sync/pull').query({ since: 'yesterday' }).expect(422);
    });

    it('tells a client with a corrupt cursor to start again rather than failing opaquely', async () => {
      const user = await registerUser(context);

      const response = await user.agent
        .get('/api/v1/sync/pull')
        .query({ cursor: 'not-a-real-cursor' })
        .expect(400);

      expect(response.body.code).toBe('INVALID_SYNC_CURSOR');
    });
  });
});
