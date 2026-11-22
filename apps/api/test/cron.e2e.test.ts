import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PUSH_TRANSPORT, type PushMessage, type PushTicket } from '../src/push/push-transport';
import { createTestApp, resetDatabase, type TestContext } from './harness';

/**
 * The endpoint a platform scheduler (Vercel Cron) calls to run the jobs, for hosting
 * where the in-process timers never fire.
 *
 * What matters: it runs the jobs for the scheduler and for nobody else.
 */

const SECRET = 'cron-secret-for-tests-only-0123456789abcdef';

const silentTransport = {
  send: (messages: PushMessage[]): Promise<PushTicket[]> =>
    Promise.resolve(messages.map(() => ({ ok: true }))),
};

describe('scheduled jobs endpoint', () => {
  let context: TestContext;
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = SECRET;
    context = await createTestApp({
      overrides: [{ token: PUSH_TRANSPORT, value: silentTransport }],
    });
  });

  afterAll(async () => {
    await context.app.close();
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  });

  beforeEach(async () => {
    await resetDatabase(context.prisma);
  });

  it('runs every job for the scheduler', async () => {
    const expired = new Date(Date.now() - 60_000);
    await context.prisma.rateLimitBucket.create({
      data: { key: 'old|GET:/x|5', count: 3, resetAt: expired },
    });

    const response = await context
      .http()
      .get('/api/v1/internal/cron')
      .set('Authorization', `Bearer ${SECRET}`)
      .expect(200);

    const jobs = (response.body.ran as Array<{ job: string }>).map((entry) => entry.job);
    expect(jobs).toEqual(['reminders', 'cleanup']);
    expect(response.body.ran[1]).toMatchObject({ rateLimitBucketsDeleted: 1 });
    expect(await context.prisma.rateLimitBucket.count()).toBe(0);
  });

  it('runs only the jobs asked for', async () => {
    const response = await context
      .http()
      .get('/api/v1/internal/cron?jobs=cleanup')
      .set('Authorization', `Bearer ${SECRET}`)
      .expect(200);

    expect(response.body.ran).toHaveLength(1);
    expect(response.body.ran[0].job).toBe('cleanup');
  });

  it('rejects an unknown job instead of silently doing nothing', async () => {
    await context
      .http()
      .get('/api/v1/internal/cron?jobs=reminders,everything')
      .set('Authorization', `Bearer ${SECRET}`)
      .expect(422);
  });

  it.each([
    ['no credentials', undefined],
    ['the wrong secret', 'Bearer not-the-secret'],
    ['the secret without the scheme', SECRET],
  ])('refuses a caller with %s', async (_label, header) => {
    let call = context.http().get('/api/v1/internal/cron');
    if (header) call = call.set('Authorization', header);
    await call.expect(401);
  });
});

describe('scheduled jobs endpoint, without a configured secret', () => {
  let context: TestContext;

  beforeAll(async () => {
    delete process.env.CRON_SECRET;
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.app.close();
  });

  it('does not exist', async () => {
    // A deployment that runs the timers in-process has no use for the route, and an
    // endpoint that triggers work should not be reachable where nobody guards it.
    await context
      .http()
      .get('/api/v1/internal/cron')
      .set('Authorization', 'Bearer anything')
      .expect(404);
  });
});
