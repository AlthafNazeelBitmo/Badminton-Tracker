import type { SQLiteDatabase } from 'expo-sqlite';
import { createTestDatabase } from '../db/testing';
import {
  MAX_ATTEMPTS,
  backoffSecondsFor,
  claimReady,
  countFailed,
  countPending,
  enqueue,
  listAll,
  millisecondsUntilNextAttempt,
  newIdempotencyKey,
  recordPermanentFailure,
  recordRetryableFailure,
  remove,
  retryFailed,
} from './outbox';

/**
 * The outbox holds the only data in the app that exists nowhere else. These tests run
 * against a real in-memory SQLite database rather than a mock, because the failures worth
 * catching here are SQL failures.
 */

let db: SQLiteDatabase;

const matchEntry = {
  kind: 'CREATE_MATCH' as const,
  entityId: 'match-1',
  endpoint: '/matches',
  method: 'POST' as const,
  body: { discipline: 'SINGLES', games: [{ myScore: 21, opponentScore: 15 }] },
};

beforeEach(async () => {
  db = await createTestDatabase();
});

afterEach(async () => {
  await db.closeAsync();
});

describe('enqueue', () => {
  it('stores an entry ready to send immediately', async () => {
    const entry = await enqueue(matchEntry, db);

    expect(entry.status).toBe('PENDING');
    expect(entry.attempts).toBe(0);
    expect(await countPending(db)).toBe(1);

    const [ready] = await claimReady(20, db);
    expect(ready?.id).toBe(entry.id);
    // Round-tripped through SQLite as JSON, so this checks the body survives storage.
    expect(ready?.body).toEqual(matchEntry.body);
  });

  it('gives every entry a distinct idempotency key', async () => {
    const first = await enqueue(matchEntry, db);
    const second = await enqueue({ ...matchEntry, entityId: 'match-2' }, db);

    // Two matches sharing a key would mean the second is silently discarded as a replay
    // of the first — the app would appear to record it and the server would not.
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  it('generates keys the API will accept', () => {
    const key = newIdempotencyKey();

    // Mirrors the server's own rule: 16-128 characters, URL-safe.
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).toMatch(/^[A-Za-z0-9._:-]+$/);
  });
});

describe('ordering', () => {
  it('returns entries in the order they were queued', async () => {
    // Causal order, not just tidiness: an update to a match must not reach the server
    // before the request that creates it.
    const first = await enqueue(matchEntry, db);
    await sleep(5);
    const second = await enqueue({ ...matchEntry, entityId: 'match-2' }, db);
    await sleep(5);
    const third = await enqueue(
      { ...matchEntry, kind: 'UPDATE_MATCH', entityId: 'match-1', method: 'PATCH' },
      db,
    );

    const ready = await claimReady(20, db);
    expect(ready.map((entry) => entry.id)).toEqual([first.id, second.id, third.id]);
  });
});

describe('retry scheduling', () => {
  it('backs off further after each failure and then stops growing', async () => {
    const delays = Array.from({ length: 10 }, (_, attempt) => backoffSecondsFor(attempt));

    // Monotonic, so each failure waits at least as long as the one before.
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1]!);
    }
    // Capped, because the usual cause is no signal, which is not fixed by asking sooner —
    // but the cap has to stay short enough that regaining signal syncs promptly.
    expect(Math.max(...delays)).toBeLessThanOrEqual(300);
  });

  it('holds an entry back until its next attempt is due', async () => {
    const entry = await enqueue(matchEntry, db);
    await recordRetryableFailure(entry.id, 'offline', db);

    // Still pending, but not yet ready — the backoff is the point.
    expect(await countPending(db)).toBe(1);
    expect(await claimReady(20, db)).toHaveLength(0);

    const wait = await millisecondsUntilNextAttempt(db);
    expect(wait).toBeGreaterThan(0);
  });

  it('parks an entry after too many attempts rather than deleting it', async () => {
    const entry = await enqueue(matchEntry, db);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await recordRetryableFailure(entry.id, 'offline', db);
    }

    // Deleting would silently lose a match somebody played. Parking surfaces it instead.
    expect(await countFailed(db)).toBe(1);
    expect(await countPending(db)).toBe(0);

    const [parked] = await listAll(db);
    expect(parked?.status).toBe('FAILED');
    expect(parked?.lastError).toBe('offline');
  });

  it('parks a rejected entry immediately instead of retrying a request that cannot succeed', async () => {
    const entry = await enqueue(matchEntry, db);
    await recordPermanentFailure(entry.id, '21-3 is not a reachable score.', db);

    // Twelve identical rejections would delay everything queued behind it for no gain.
    expect(await countFailed(db)).toBe(1);
    expect(await claimReady(20, db)).toHaveLength(0);
  });

  it('keeps the original idempotency key when a failed entry is retried by hand', async () => {
    const entry = await enqueue(matchEntry, db);
    await recordPermanentFailure(entry.id, 'server rejected it', db);
    await retryFailed(entry.id, db);

    const [requeued] = await claimReady(20, db);
    expect(requeued?.status).toBe('PENDING');
    expect(requeued?.attempts).toBe(0);
    // The key is what makes this safe. If the first attempt did reach the server, this
    // retry returns that same match instead of creating a duplicate.
    expect(requeued?.idempotencyKey).toBe(entry.idempotencyKey);
  });

  it('ignores a retry request for an entry that is not failed', async () => {
    const entry = await enqueue(matchEntry, db);
    await recordRetryableFailure(entry.id, 'offline', db);
    await retryFailed(entry.id, db);

    // Resetting a backing-off entry to "due now" on a stray tap would defeat the backoff.
    expect(await claimReady(20, db)).toHaveLength(0);
  });
});

describe('completion', () => {
  it('drops an entry once the server has accepted it', async () => {
    const entry = await enqueue(matchEntry, db);
    await remove(entry.id, db);

    expect(await countPending(db)).toBe(0);
    expect(await listAll(db)).toHaveLength(0);
  });

  it('reports nothing waiting when the queue is empty', async () => {
    expect(await millisecondsUntilNextAttempt(db)).toBeNull();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
