import type { SQLiteDatabase } from 'expo-sqlite';
import type { SyncMatch, SyncPullResponse } from '@badminton/contracts';
import { createTestDatabase } from '../db/testing';
import { countMatches, listMatches, listPlayers, localCounts } from '../db/cache';
import { SYNC_STATE_KEYS } from '../db/schema';
import { readState, writeState } from './sync-state';
import { claimReady, countFailed, countPending, enqueue, listAll } from './outbox';
import { __resetSyncState, hasDiverged, resetSyncCursor, sync } from './engine';
import { ApiError, NetworkError } from '../api/errors';
import { recordMatch } from '../repositories/matches';

jest.mock('../api/client', () => ({ request: jest.fn() }));
jest.mock('../db/database', () => ({
  getDatabase: jest.fn(),
  migrate: jest.requireActual('../db/database').migrate,
}));

import { request } from '../api/client';
import { getDatabase } from '../db/database';

const mockRequest = request as jest.MockedFunction<typeof request>;
const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

/**
 * The engine decides what reaches the server and what reaches the screen. The failures
 * that matter are the quiet ones — a queued match dropped, a cursor advanced past records
 * that were never stored — so those are what these tests pin down.
 */

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  mockGetDatabase.mockResolvedValue(db);
  mockRequest.mockReset();
  __resetSyncState();
});

afterEach(async () => {
  await db.closeAsync();
});

function pullPage(overrides: Partial<SyncPullResponse> = {}): SyncPullResponse {
  return {
    syncedAt: '2026-08-18T10:00:00.000Z',
    hasMore: false,
    cursor: null,
    changed: { matches: [], sessions: [], players: [], venues: [] },
    deleted: { matchIds: [], sessionIds: [], playerIds: [], venueIds: [] },
    counts: { matches: 0, sessions: 0, players: 0, venues: 0 },
    ...overrides,
  };
}

function syncMatch(id: string, playedAt = '2026-08-01T18:00:00.000Z'): SyncMatch {
  return {
    id,
    sessionId: `session-${id}`,
    playedAt,
    orderInSession: 1,
    discipline: 'SINGLES',
    scoring: { pointsToWin: 21, winBy: 2, maxPoints: 30, bestOf: 3 },
    durationSeconds: null,
    difficulty: null,
    energyLevel: null,
    confidence: null,
    feeling: null,
    notes: null,
    tags: [],
    venue: null,
    partnerIds: [],
    opponentIds: ['opponent-1'],
    partnerNames: [],
    opponentNames: ['Priya'],
    games: [
      { gameNumber: 1, myScore: 21, opponentScore: 15 },
      { gameNumber: 2, myScore: 21, opponentScore: 17 },
    ],
    derived: {
      result: 'WIN',
      gamesWon: 2,
      gamesLost: 0,
      pointsScored: 42,
      pointsConceded: 32,
      pointDifferential: 10,
      averagePointsPerGame: 21,
      margin: 2,
      isComeback: false,
      isCollapse: false,
      wentToDecider: false,
      isClutch: false,
      isBlowout: false,
      longestGameMargin: 6,
      closestGameMargin: 4,
    },
    updatedAt: '2026-08-01T18:05:00.000Z',
  };
}

const queuedMatch = {
  kind: 'CREATE_MATCH' as const,
  entityId: 'match-local',
  endpoint: '/matches',
  method: 'POST' as const,
  body: { discipline: 'SINGLES' },
};

describe('push before pull', () => {
  it('drains the outbox before pulling anything', async () => {
    await enqueue(queuedMatch, db);

    const calls: string[] = [];
    mockRequest.mockImplementation(async (path: string) => {
      calls.push(path);
      return path === '/sync/pull' ? pullPage() : ({} as never);
    });

    await sync(db);

    // If the order were reversed, a pull would overwrite the cached copy of a match that
    // has not reached the server yet, and it would vanish from the history while still
    // sitting in the queue.
    expect(calls[0]).toBe('/matches');
    expect(calls).toContain('/sync/pull');
  });

  it('removes an entry from the outbox once the server accepts it', async () => {
    await enqueue(queuedMatch, db);
    mockRequest.mockImplementation(async (path: string) =>
      path === '/sync/pull' ? pullPage() : ({} as never),
    );

    const outcome = await sync(db);

    expect(outcome).toMatchObject({ status: 'SYNCED', pushed: 1 });
    expect(await countPending(db)).toBe(0);
  });

  it('sends the entry’s idempotency key so a lost response cannot duplicate the match', async () => {
    const entry = await enqueue(queuedMatch, db);
    mockRequest.mockImplementation(async (path: string) =>
      path === '/sync/pull' ? pullPage() : ({} as never),
    );

    await sync(db);

    expect(mockRequest).toHaveBeenCalledWith(
      '/matches',
      expect.objectContaining({ idempotencyKey: entry.idempotencyKey }),
    );
  });
});

describe('failure handling', () => {
  it('keeps a queued match when the phone is offline', async () => {
    await enqueue(queuedMatch, db);
    mockRequest.mockRejectedValue(new NetworkError());

    const outcome = await sync(db);

    expect(outcome.status).toBe('OFFLINE');
    // The entry is the only copy of that match. Losing it here loses the match.
    expect(await countPending(db)).toBe(1);
    expect(await countFailed(db)).toBe(0);
  });

  it('stops pushing at the first network failure instead of working through the queue', async () => {
    await enqueue(queuedMatch, db);
    await enqueue({ ...queuedMatch, entityId: 'match-2' }, db);
    await enqueue({ ...queuedMatch, entityId: 'match-3' }, db);

    mockRequest.mockRejectedValue(new NetworkError());
    await sync(db);

    // Continuing would reorder operations and hammer a network that has just shown it is
    // not there. Only the first entry should have been attempted.
    const entries = await listAll(db);
    expect(entries.filter((entry) => entry.attempts > 0)).toHaveLength(1);
  });

  it('parks a rejected entry immediately and carries on with the rest', async () => {
    await enqueue(queuedMatch, db);
    await enqueue({ ...queuedMatch, entityId: 'match-2' }, db);

    let call = 0;
    mockRequest.mockImplementation(async (path: string) => {
      if (path === '/sync/pull') return pullPage();
      call += 1;
      if (call === 1) {
        throw new ApiError(422, 'VALIDATION_FAILED', '21-3 is not a reachable score.');
      }
      return {} as never;
    });

    const outcome = await sync(db);

    // The rejection is final, so it is parked rather than retried twelve times — but the
    // entry behind it is unrelated and must still go.
    expect(await countFailed(db)).toBe(1);
    expect(outcome).toMatchObject({ pushed: 1 });
  });

  it('reports the session as lost rather than parking every queued match', async () => {
    await enqueue(queuedMatch, db);
    mockRequest.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Session expired.'));

    const outcome = await sync(db);

    expect(outcome.status).toBe('UNAUTHENTICATED');
    // Signing in again should send these, so they must survive.
    expect(await countPending(db)).toBe(1);
    expect(await countFailed(db)).toBe(0);
  });

  it('keeps what it pushed when the pull then fails', async () => {
    await enqueue(queuedMatch, db);
    mockRequest.mockImplementation(async (path: string) => {
      if (path === '/sync/pull') throw new NetworkError();
      return {} as never;
    });

    const outcome = await sync(db);

    expect(outcome).toMatchObject({ status: 'OFFLINE', pushed: 1 });
    expect(await countPending(db)).toBe(0);
  });
});

describe('pulling', () => {
  it('stores what it receives and records the cursor for next time', async () => {
    mockRequest.mockResolvedValue(
      pullPage({
        changed: {
          matches: [syncMatch('match-1')],
          sessions: [],
          players: [],
          venues: [],
        },
        counts: { matches: 1, sessions: 0, players: 0, venues: 0 },
      }),
    );

    await sync(db);

    expect(await countMatches(db)).toBe(1);
    expect(await readState(SYNC_STATE_KEYS.lastSyncedAt, db)).toBe('2026-08-18T10:00:00.000Z');
  });

  it('follows the cursor through every page', async () => {
    const pages: SyncPullResponse[] = [
      pullPage({
        hasMore: true,
        cursor: 'cursor-1',
        changed: { matches: [syncMatch('match-1')], sessions: [], players: [], venues: [] },
      }),
      pullPage({
        hasMore: true,
        cursor: 'cursor-2',
        changed: { matches: [syncMatch('match-2')], sessions: [], players: [], venues: [] },
      }),
      pullPage({
        hasMore: false,
        cursor: null,
        changed: { matches: [syncMatch('match-3')], sessions: [], players: [], venues: [] },
        counts: { matches: 3, sessions: 0, players: 0, venues: 0 },
      }),
    ];

    let page = 0;
    const seenCursors: Array<string | undefined> = [];
    mockRequest.mockImplementation(
      async (_path: string, options?: { query?: Record<string, unknown> }) => {
        seenCursors.push(options?.query?.cursor as string | undefined);
        return pages[page++]!;
      },
    );

    await sync(db);

    expect(await countMatches(db)).toBe(3);
    // The first request starts a run and carries no cursor; each later one echoes the
    // previous page's cursor back.
    expect(seenCursors).toEqual([undefined, 'cursor-1', 'cursor-2']);
  });

  it('does not record syncedAt until the run finishes', async () => {
    mockRequest.mockResolvedValue(
      pullPage({
        hasMore: true,
        cursor: 'cursor-1',
        changed: { matches: [syncMatch('match-1')], sessions: [], players: [], venues: [] },
      }),
    );

    await sync(db);

    // Recording it mid-run would make the next run start from "now" and skip every page
    // this one never fetched.
    expect(await readState(SYNC_STATE_KEYS.lastSyncedAt, db)).toBeNull();
    expect(await readState(SYNC_STATE_KEYS.pendingCursor, db)).toBe('cursor-1');
  });

  it('resumes an interrupted run from its stored cursor', async () => {
    await writeState(SYNC_STATE_KEYS.pendingCursor, 'saved-cursor', db);
    mockRequest.mockResolvedValue(pullPage());

    await sync(db);

    expect(mockRequest).toHaveBeenCalledWith(
      '/sync/pull',
      expect.objectContaining({ query: expect.objectContaining({ cursor: 'saved-cursor' }) }),
    );
  });

  it('sends since, not a cursor, when starting a fresh run', async () => {
    await writeState(SYNC_STATE_KEYS.lastSyncedAt, '2026-08-17T00:00:00.000Z', db);
    mockRequest.mockResolvedValue(pullPage());

    await sync(db);

    const [, options] = mockRequest.mock.calls[0] as [string, { query: Record<string, unknown> }];
    expect(options.query.since).toBe('2026-08-17T00:00:00.000Z');
    expect(options.query.cursor).toBeUndefined();
  });

  it('marks a synced match as no longer pending', async () => {
    await enqueue(queuedMatch, db);

    mockRequest.mockImplementation(async (path: string) =>
      path === '/sync/pull'
        ? pullPage({
            changed: {
              matches: [syncMatch('match-1')],
              sessions: [],
              players: [],
              venues: [],
            },
            counts: { matches: 1, sessions: 0, players: 0, venues: 0 },
          })
        : ({} as never),
    );

    await sync(db);

    const [match] = await listMatches({}, db);
    // The badge saying "not synced yet" has to come off, or every match keeps it forever.
    expect(match?.pendingLocal).toBe(false);
  });
});

describe('concurrency', () => {
  it('joins an in-flight sync instead of starting a second one', async () => {
    mockRequest.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return pullPage();
    });

    const [first, second] = await Promise.all([sync(db), sync(db)]);

    expect(first).toEqual(second);
    // Two runs would race on the cursor and could advance it past records the other had
    // not yet stored.
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe('divergence detection', () => {
  it('notices when the device holds more than the server says exists', async () => {
    mockRequest.mockResolvedValue(
      pullPage({
        changed: {
          matches: [syncMatch('match-1'), syncMatch('match-2')],
          sessions: [],
          players: [],
          venues: [],
        },
        counts: { matches: 2, sessions: 0, players: 0, venues: 0 },
      }),
    );
    await sync(db);
    expect(await hasDiverged(db)).toBe(false);

    // A match deleted on another device leaves no trace here — no tombstones — so the
    // count is the only signal that the cache is now wrong.
    await writeState(
      SYNC_STATE_KEYS.serverCounts,
      JSON.stringify({ matches: 1, sessions: 0, players: 0, venues: 0 }),
      db,
    );

    expect(await hasDiverged(db)).toBe(true);
  });

  it('does not call a half-finished first sync a divergence', async () => {
    await writeState(
      SYNC_STATE_KEYS.serverCounts,
      JSON.stringify({ matches: 500, sessions: 20, players: 30, venues: 4 }),
      db,
    );

    // Holding fewer records than the server is the ordinary state of a sync still in
    // progress. Treating it as drift would make a first sync restart itself forever.
    expect(await hasDiverged(db)).toBe(false);
  });

  it('reports no divergence before the first sync has said anything', async () => {
    expect(await hasDiverged(db)).toBe(false);
  });
});

describe('resetSyncCursor', () => {
  it('clears the cursor but keeps the cache', async () => {
    mockRequest.mockResolvedValue(
      pullPage({
        changed: { matches: [syncMatch('match-1')], sessions: [], players: [], venues: [] },
        counts: { matches: 1, sessions: 0, players: 0, venues: 0 },
      }),
    );
    await sync(db);

    await resetSyncCursor(db);

    expect(await readState(SYNC_STATE_KEYS.lastSyncedAt, db)).toBeNull();
    // Emptying the cache would blank the history screen for the length of the re-pull.
    // Stale data beats no data.
    expect((await localCounts(db)).matches).toBe(1);
  });
});

describe('outbox ordering under failure', () => {
  it('leaves later entries untouched and still due', async () => {
    await enqueue(queuedMatch, db);
    await enqueue({ ...queuedMatch, entityId: 'match-2' }, db);

    mockRequest.mockRejectedValue(new NetworkError());
    await sync(db);

    const entries = await listAll(db);
    const untouched = entries.find((entry) => entry.entityId === 'match-2');
    expect(untouched?.attempts).toBe(0);
    expect(untouched?.status).toBe('PENDING');

    // And once the network returns, both are ready in their original order.
    mockRequest.mockImplementation(async (path: string) =>
      path === '/sync/pull' ? pullPage() : ({} as never),
    );
    await db.runAsync(`UPDATE outbox SET next_attempt_at = ?`, [new Date(0).toISOString()]);
    __resetSyncState();

    const ready = await claimReady(20, db);
    expect(ready.map((entry) => entry.entityId)).toEqual(['match-local', 'match-2']);
  });
});

describe('cleaning up once the server has had its say', () => {
  /** Holds every queued entry back, as if its backoff had not expired yet. */
  async function holdOutbox(): Promise<void> {
    await db.runAsync(`UPDATE outbox SET next_attempt_at = ?`, [
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ]);
  }

  const offlineMatch = {
    discipline: 'SINGLES' as const,
    session: { date: '2026-08-18', sessionType: 'CASUAL' as const },
    partners: [],
    opponents: [{ name: 'priya' }],
    games: [
      { myScore: 21, opponentScore: 15 },
      { myScore: 21, opponentScore: 17 },
    ],
  };

  it('drops a player named offline whom the server matched to someone it already knew', async () => {
    const { match } = await recordMatch(offlineMatch, db);

    // The server already had a "Priya", so it kept her rather than creating a second one.
    // The next pull rewrites the match to point at her.
    mockRequest.mockImplementation(async (path: string) =>
      path === '/sync/pull'
        ? pullPage({
            changed: {
              matches: [
                {
                  ...syncMatch(match.id),
                  opponentIds: ['player-priya'],
                  opponentNames: ['Priya'],
                },
              ],
              sessions: [],
              players: [
                {
                  id: 'player-priya',
                  name: 'Priya',
                  nickname: null,
                  relationship: null,
                  isSelf: false,
                  rating: null,
                  updatedAt: '2026-08-18T10:00:00.000Z',
                },
              ],
              venues: [],
            },
            counts: { matches: 1, sessions: 0, players: 1, venues: 0 },
          })
        : ({} as never),
    );

    await sync(db);

    // Before, the picker showed both "priya" and "Priya" from here on.
    const players = await listPlayers(undefined, db);
    expect(players.map((player) => player.name)).toEqual(['Priya']);
  });

  it('keeps a new player while their match is still waiting to upload', async () => {
    await recordMatch(offlineMatch, db);
    await holdOutbox();
    mockRequest.mockResolvedValue(pullPage());

    await sync(db);

    // The server has not seen this match yet, so it has not had a chance to decide who
    // "priya" is. Removing her now would leave the queued match pointing at nobody.
    expect((await listPlayers(undefined, db)).map((player) => player.name)).toEqual(['priya']);
  });

  it('removes a match that was deleted on another device', async () => {
    mockRequest.mockResolvedValueOnce(
      pullPage({
        changed: {
          matches: [syncMatch('kept-1'), syncMatch('kept-2'), syncMatch('deleted-on-web')],
          sessions: [],
          players: [],
          venues: [],
        },
        counts: { matches: 3, sessions: 0, players: 0, venues: 0 },
      }),
    );
    await sync(db);
    expect(await countMatches(db)).toBe(3);

    // Deleted on the website. Nothing is sent about it — only the count drops.
    __resetSyncState();
    mockRequest.mockImplementation(async (path: string) =>
      path === '/sync/manifest'
        ? { matchIds: ['kept-1', 'kept-2'], sessionIds: [], playerIds: [], venueIds: [] }
        : pullPage({ counts: { matches: 2, sessions: 0, players: 0, venues: 0 } }),
    );
    await sync(db);

    const remaining = await listMatches({}, db);
    expect(remaining.map((match) => match.id).sort()).toEqual(['kept-1', 'kept-2']);
  });

  it('never removes a match that is still waiting to upload', async () => {
    const { match: offline } = await recordMatch(offlineMatch, db);
    await holdOutbox();

    mockRequest.mockResolvedValueOnce(
      pullPage({
        changed: {
          matches: [syncMatch('kept'), syncMatch('deleted-on-web')],
          sessions: [],
          players: [],
          venues: [],
        },
        counts: { matches: 2, sessions: 0, players: 0, venues: 0 },
      }),
    );
    await sync(db);

    __resetSyncState();
    mockRequest.mockImplementation(async (path: string) =>
      path === '/sync/manifest'
        ? { matchIds: ['kept'], sessionIds: [], playerIds: [], venueIds: [] }
        : pullPage({ counts: { matches: 1, sessions: 0, players: 0, venues: 0 } }),
    );
    await sync(db);

    // Missing from the manifest because the server has not seen it yet, not because
    // anyone deleted it. Removing it would delete a match somebody just recorded.
    const ids = (await listMatches({}, db)).map((match) => match.id).sort();
    expect(ids).toEqual(['kept', offline.id].sort());
  });

  it('does not fetch the manifest when nothing was deleted', async () => {
    mockRequest.mockResolvedValue(
      pullPage({
        changed: { matches: [syncMatch('only')], sessions: [], players: [], venues: [] },
        counts: { matches: 1, sessions: 0, players: 0, venues: 0 },
      }),
    );

    await sync(db);

    expect(mockRequest).not.toHaveBeenCalledWith('/sync/manifest');
  });

  it('does not mistake a match waiting to upload for something deleted elsewhere', async () => {
    await recordMatch(offlineMatch, db);
    await holdOutbox();
    mockRequest.mockResolvedValue(pullPage());

    await sync(db);

    // One local match, a server count of zero — but the local one is unconfirmed, so this
    // is not a surplus. Counting it would send every sync off to fetch the manifest.
    expect(mockRequest).not.toHaveBeenCalledWith('/sync/manifest');
  });

  it('does not judge the cache part-way through a run', async () => {
    // Counts from an earlier run that say the cache holds too much.
    await writeState(
      SYNC_STATE_KEYS.serverCounts,
      JSON.stringify({ matches: 0, sessions: 0, players: 0, venues: 0 }),
      db,
    );
    mockRequest.mockResolvedValue(
      pullPage({
        hasMore: true,
        cursor: 'more',
        changed: { matches: [syncMatch('half-way')], sessions: [], players: [], venues: [] },
      }),
    );

    await sync(db);

    // Mid-run, the server's version of the data has not all arrived; acting now would
    // compare the cache against half the picture.
    expect(mockRequest).not.toHaveBeenCalledWith('/sync/manifest');
    expect(await countMatches(db)).toBe(1);
  });

  it('leaves the cache alone if the manifest comes back malformed', async () => {
    mockRequest.mockResolvedValueOnce(
      pullPage({
        changed: {
          matches: [syncMatch('a'), syncMatch('b')],
          sessions: [],
          players: [],
          venues: [],
        },
        counts: { matches: 2, sessions: 0, players: 0, venues: 0 },
      }),
    );
    await sync(db);

    __resetSyncState();
    mockRequest.mockImplementation(async (path: string) =>
      path === '/sync/manifest'
        ? ({ unexpected: true } as never)
        : pullPage({ counts: { matches: 1, sessions: 0, players: 0, venues: 0 } }),
    );
    await sync(db);

    // Deleting on the strength of a bad answer would empty the cache.
    expect(await countMatches(db)).toBe(2);
  });
});

describe('a retry after the server has forgotten its key', () => {
  const lateEntry = {
    kind: 'CREATE_MATCH' as const,
    entityId: 'match-landed-earlier',
    endpoint: '/matches',
    method: 'POST' as const,
    body: { id: 'match-landed-earlier', discipline: 'SINGLES' },
  };

  const duplicate = () =>
    new ApiError(409, 'DUPLICATE', 'A record with these details already exists.');

  it('counts it as delivered when the match is already there', async () => {
    await enqueue(lateEntry, db);
    mockRequest.mockImplementation(async (path: string) => {
      if (path === '/matches') throw duplicate();
      if (path === '/matches/match-landed-earlier') return { id: 'match-landed-earlier' } as never;
      return pullPage();
    });

    const outcome = await sync(db);

    // The first attempt did land; only its reply was lost. Parking this would tell the
    // user a saved match "could not be saved".
    expect(outcome).toMatchObject({ status: 'SYNCED', pushed: 1 });
    expect(await countFailed(db)).toBe(0);
    expect(await countPending(db)).toBe(0);
  });

  it('still parks it when the conflict turns out to be about something else', async () => {
    await enqueue(lateEntry, db);
    mockRequest.mockImplementation(async (path: string) => {
      if (path === '/matches') throw duplicate();
      if (path === '/matches/match-landed-earlier')
        throw new ApiError(404, 'NOT_FOUND', 'Not found.');
      return pullPage();
    });

    await sync(db);

    expect(await countFailed(db)).toBe(1);
  });

  it('tries again later if the check itself cannot reach the server', async () => {
    await enqueue(lateEntry, db);
    mockRequest.mockImplementation(async (path: string) => {
      if (path === '/matches') throw duplicate();
      throw new NetworkError();
    });

    await sync(db);

    const [entry] = await listAll(db);
    expect(entry?.status).toBe('PENDING');
    expect(entry?.attempts).toBe(1);
  });

  it('does not apply the check to other kinds of conflict', async () => {
    await enqueue(lateEntry, db);
    mockRequest.mockImplementation(async (path: string) => {
      if (path === '/matches') {
        throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED', 'Key used for a different request.');
      }
      return pullPage();
    });

    await sync(db);

    // Same key, different body: a client bug. Looking the match up would hide it.
    expect(mockRequest).not.toHaveBeenCalledWith('/matches/match-landed-earlier');
    expect(await countFailed(db)).toBe(1);
  });
});
