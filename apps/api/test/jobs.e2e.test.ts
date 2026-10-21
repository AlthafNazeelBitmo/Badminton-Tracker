import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_KEY_HEADER } from '@badminton/contracts';
import {
  PUSH_TRANSPORT,
  type PushMessage,
  type PushTicket,
  type PushTransport,
} from '../src/push/push-transport';
import { MaintenanceService } from '../src/jobs/maintenance.service';
import { PushService } from '../src/push/push.service';
import {
  createTestApp,
  recordMatch,
  registerUser,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './harness';

/**
 * Background jobs: reminders that reach a phone, and housekeeping that keeps a table
 * from growing forever.
 *
 * The push provider is replaced by a recorder. These tests prove what would be sent and
 * to whom, and must never notify a real device.
 */

class RecordingTransport implements PushTransport {
  readonly sent: PushMessage[] = [];
  readonly dead = new Set<string>();

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map((message) =>
      this.dead.has(message.to)
        ? { ok: false, error: 'DeviceNotRegistered', deviceGone: true }
        : { ok: true },
    );
  }

  reset(): void {
    this.sent.length = 0;
    this.dead.clear();
  }

  ofType(type: string): PushMessage[] {
    return this.sent.filter((message) => message.data?.type === type);
  }
}

/** Midday UTC today: inside the delivery window for anyone on UTC. */
function middayUtc(): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  return date;
}

function atUtcHour(hour: number): Date {
  const date = new Date();
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

describe('background jobs', () => {
  const transport = new RecordingTransport();
  let context: TestContext;
  let maintenance: MaintenanceService;
  let push: PushService;

  beforeAll(async () => {
    context = await createTestApp({ overrides: [{ token: PUSH_TRANSPORT, value: transport }] });
    maintenance = context.app.get(MaintenanceService);
    push = context.app.get(PushService);
  });

  afterAll(async () => {
    await context.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
    transport.reset();
  });

  async function addPhone(user: TestUser, token: string, installationId = `install-${token}`) {
    await user.agent
      .post('/api/v1/devices')
      .send({ installationId, platform: 'IOS', pushToken: token })
      .expect(200);
  }

  describe('reminders', () => {
    it('reminds someone who has stopped playing, on every phone they registered', async () => {
      const lapsed = await registerUser(context);
      // The harness records matches on 2026-08-01, comfortably past the inactivity
      // threshold by the time this suite runs.
      await recordMatch(lapsed);
      await addPhone(lapsed, 'ExponentPushToken[phone-a]');
      await addPhone(lapsed, 'ExponentPushToken[tablet-a]');

      // Someone else, with history but no phone registered.
      const webOnly = await registerUser(context);
      await recordMatch(webOnly);

      const result = await maintenance.runReminders(middayUtc());

      const reminders = transport.ofType('INACTIVITY');
      expect(reminders.map((message) => message.to).sort()).toEqual([
        'ExponentPushToken[phone-a]',
        'ExponentPushToken[tablet-a]',
      ]);
      expect(reminders[0]?.title).toMatch(/days since your last match/);
      // Only people who can receive a push are generated for at all.
      expect(result.usersChecked).toBe(1);
    });

    it('never sends the same reminder twice', async () => {
      const user = await registerUser(context);
      await recordMatch(user);
      await addPhone(user, 'ExponentPushToken[once]');

      await maintenance.runReminders(middayUtc());
      const afterFirst = transport.sent.length;
      expect(afterFirst).toBeGreaterThan(0);

      await maintenance.runReminders(middayUtc());
      expect(transport.sent.length).toBe(afterFirst);
    });

    it('sends each reminder once even when two runners overlap', async () => {
      const user = await registerUser(context);
      await recordMatch(user);
      await addPhone(user, 'ExponentPushToken[race]');

      // Two API instances, or a timer and the jobs command, firing at the same moment.
      await Promise.all([
        maintenance.runReminders(middayUtc()),
        maintenance.runReminders(middayUtc()),
      ]);

      expect(transport.ofType('INACTIVITY')).toHaveLength(1);
    });

    it('holds a reminder overnight and sends it in the morning, in the user’s time zone', async () => {
      const user = await registerUser(context, { timeZone: 'Asia/Kolkata' });
      await recordMatch(user);
      await addPhone(user, 'ExponentPushToken[kolkata]');

      // 22:00 UTC is 03:30 in Kolkata.
      const night = await maintenance.runReminders(atUtcHour(22));
      expect(transport.ofType('INACTIVITY')).toHaveLength(0);
      expect(night.deferred).toBeGreaterThan(0);

      // 06:00 UTC is 11:30 in Kolkata. Held, not dropped.
      await maintenance.runReminders(atUtcHour(6));
      expect(transport.ofType('INACTIVITY')).toHaveLength(1);
    });

    it('clears a token the push service reports as dead', async () => {
      const user = await registerUser(context);
      await recordMatch(user);
      await addPhone(user, 'ExponentPushToken[uninstalled]');
      transport.dead.add('ExponentPushToken[uninstalled]');

      const result = await maintenance.runReminders(middayUtc());

      expect(result.tokensCleared).toBeGreaterThan(0);
      const devices = await user.agent.get('/api/v1/devices').expect(200);
      // Sending to it again could never succeed, and counts against sender reputation.
      expect(devices.body[0].pushEnabled).toBe(false);
    });

    it('announces a goal when it is reached', async () => {
      const user = await registerUser(context);
      await addPhone(user, 'ExponentPushToken[goals]');
      await user.agent
        .post('/api/v1/goals')
        .send({
          title: 'Play a match',
          metric: 'MATCHES_PLAYED',
          targetValue: 1,
          startsOn: '2026-07-01',
        })
        .expect(201);

      await recordMatch(user);
      await maintenance.runReminders(middayUtc());

      const goalPushes = transport.ofType('GOAL_PROGRESS');
      expect(goalPushes.map((message) => message.title)).toEqual(['Goal reached: Play a match']);
    });

    it('announces a goal even if the goals page marked it achieved first', async () => {
      const user = await registerUser(context);
      await addPhone(user, 'ExponentPushToken[goals-first]');
      await user.agent
        .post('/api/v1/goals')
        .send({ title: 'First win', metric: 'MATCHES_WON', targetValue: 1, startsOn: '2026-07-01' })
        .expect(201);
      await recordMatch(user);

      // Opening the goals page is what moves a met goal to ACHIEVED. After that it is no
      // longer active, so a check that only looked at active goals would miss it.
      await user.agent.get('/api/v1/goals').expect(200);

      await maintenance.runReminders(middayUtc());
      expect(transport.ofType('GOAL_PROGRESS')).toHaveLength(1);
    });

    it('keeps streaks and milestones in the app rather than interrupting anyone', async () => {
      const user = await registerUser(context);
      await addPhone(user, 'ExponentPushToken[chatty]');
      for (let index = 0; index < 7; index += 1) await recordMatch(user);

      await maintenance.runReminders(middayUtc());

      const inApp = await user.agent.get('/api/v1/notifications').expect(200);
      const types = inApp.body.items.map((item: { type: string }) => item.type);
      expect(types).toEqual(expect.arrayContaining(['STREAK', 'MILESTONE']));

      expect(transport.ofType('STREAK')).toHaveLength(0);
      expect(transport.ofType('MILESTONE')).toHaveLength(0);
    });

    it('does not push news that is more than two days old', async () => {
      const user = await registerUser(context);
      await addPhone(user, 'ExponentPushToken[stale]');
      await context.prisma.notification.create({
        data: {
          userId: user.id,
          type: 'INACTIVITY',
          title: 'Old news',
          body: 'From before the job was running.',
          dedupeKey: 'test:stale',
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      });

      await push.dispatchPending(new Date());

      expect(transport.sent.filter((message) => message.title === 'Old news')).toHaveLength(0);
    });

    it('sends nothing to a disabled account', async () => {
      const user = await registerUser(context);
      await recordMatch(user);
      await addPhone(user, 'ExponentPushToken[disabled]');
      await context.prisma.user.update({
        where: { id: user.id },
        data: { disabledAt: new Date() },
      });

      await maintenance.runReminders(middayUtc());

      expect(transport.sent).toHaveLength(0);
    });
  });

  describe('idempotency key retention', () => {
    const matchBody = {
      discipline: 'SINGLES' as const,
      session: { date: '2026-08-01', sessionType: 'CASUAL' as const },
      partners: [],
      opponents: [{ name: 'Retention Opponent' }],
      games: [
        { myScore: 21, opponentScore: 15 },
        { myScore: 21, opponentScore: 12 },
      ],
    };

    it('deletes keys past their retention and keeps the rest', async () => {
      const user = await registerUser(context);
      const stored = {
        userId: user.id,
        endpoint: 'POST /v1/matches',
        requestHash: 'hash',
        statusCode: 201,
        responseBody: {},
      };
      await context.prisma.idempotencyKey.createMany({
        data: [
          { ...stored, key: 'expired-key-0000001', expiresAt: new Date(Date.now() - 60_000) },
          { ...stored, key: 'current-key-0000001', expiresAt: new Date(Date.now() + 60_000) },
        ],
      });

      const result = await maintenance.purgeExpiredIdempotencyKeys();

      expect(result.deleted).toBe(1);
      const remaining = await context.prisma.idempotencyKey.findMany({ select: { key: true } });
      expect(remaining.map((row) => row.key)).toEqual(['current-key-0000001']);
    });

    it('stops replaying an expired key, and the match id still prevents a duplicate', async () => {
      const user = await registerUser(context);
      const body = { ...matchBody, id: randomUUID() };
      const key = 'outbox-late-retry-00000001';

      await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(body)
        .expect(201);
      await context.prisma.idempotencyKey.updateMany({
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      // A phone that comes back online after the retention window. The key no longer
      // replays — but the client-assigned id is already taken, so it cannot create a
      // second match. The app recognises this answer and marks the entry delivered.
      const late = await user.agent
        .post('/api/v1/matches')
        .set(IDEMPOTENCY_KEY_HEADER, key)
        .send(body)
        .expect(409);

      expect(late.headers['idempotency-replayed']).toBeUndefined();
      expect(late.body.code).toBe('DUPLICATE');

      const matches = await user.agent.get('/api/v1/matches').expect(200);
      expect(matches.body.items).toHaveLength(1);
    });
  });
});
