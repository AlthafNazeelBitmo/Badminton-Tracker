import type { SQLiteDatabase } from 'expo-sqlite';
import type { SyncPullResponse, SyncStatusResponse } from '@badminton/contracts';
import { request } from '../api/client';
import { ApiError, isRetryable } from '../api/errors';
import { getDatabase } from '../db/database';
import {
  localCounts,
  upsertMatches,
  upsertPlayers,
  upsertSessions,
  upsertVenues,
} from '../db/cache';
import { SYNC_STATE_KEYS } from '../db/schema';
import {
  claimReady,
  recordPermanentFailure,
  recordRetryableFailure,
  remove as removeFromOutbox,
  type OutboxEntry,
} from './outbox';
import { readServerCounts, readState, writeServerCounts, writeState } from './sync-state';

/**
 * The sync engine.
 *
 * Two directions, and the order between them is not arbitrary:
 *
 *  1. **Push first.** The outbox drains before anything is pulled. Otherwise a pull would
 *     overwrite the cached copy of a match that has not reached the server yet, and the
 *     match would appear to vanish from the history while still sitting in the queue.
 *  2. **Then pull**, page by page, until the server says there is nothing more.
 *
 * The engine is deliberately not clever about conflicts. This is one person's own data on
 * their own devices; the realistic conflict is recording the same match twice, which the
 * idempotency key already prevents. Building three-way merge for a case that does not
 * arise would add a large amount of code with no way to test it against reality.
 */

export type SyncOutcome =
  | { status: 'SYNCED'; pushed: number; pulled: number }
  | { status: 'OFFLINE'; pushed: number; pulled: number }
  | { status: 'PARTIAL'; pushed: number; pulled: number; reason: string }
  | { status: 'UNAUTHENTICATED' };

/** Pages pulled in one run before yielding, so a first sync cannot block the UI forever. */
const MAX_PAGES_PER_RUN = 25;

let running: Promise<SyncOutcome> | null = null;

/**
 * Runs a sync, or joins the one already in progress.
 *
 * Sync is triggered from several places at once — app launch, regaining connectivity,
 * pull-to-refresh, saving a match. Two concurrent runs would fight over the cursor and
 * could advance it past records the other had not stored.
 */
export function sync(db?: SQLiteDatabase): Promise<SyncOutcome> {
  running ??= runSync(db).finally(() => {
    running = null;
  });
  return running;
}

async function runSync(db?: SQLiteDatabase): Promise<SyncOutcome> {
  const database = db ?? (await getDatabase());

  let pushed = 0;
  let pulled = 0;

  try {
    pushed = await push(database);
  } catch (error) {
    if (error instanceof ApiError && error.requiresReauthentication) {
      return { status: 'UNAUTHENTICATED' };
    }
    if (isRetryable(error)) return { status: 'OFFLINE', pushed, pulled };
    return { status: 'PARTIAL', pushed, pulled, reason: describe(error) };
  }

  try {
    pulled = await pull(database);
  } catch (error) {
    if (error instanceof ApiError && error.requiresReauthentication) {
      return { status: 'UNAUTHENTICATED' };
    }
    // Anything already pushed stayed pushed. Reporting OFFLINE rather than failing the
    // whole run keeps that true.
    if (isRetryable(error)) return { status: 'OFFLINE', pushed, pulled };
    return { status: 'PARTIAL', pushed, pulled, reason: describe(error) };
  }

  return { status: 'SYNCED', pushed, pulled };
}

/**
 * Drains the outbox.
 *
 * Entries are sent one at a time, in order, and the loop stops at the first entry that
 * fails for a retryable reason. Continuing past it would reorder operations — an update
 * arriving before the create it depends on — and would keep hammering a network that has
 * just demonstrated it is not there.
 */
async function push(db: SQLiteDatabase): Promise<number> {
  const entries = await claimReady(50, db);
  let sent = 0;

  for (const entry of entries) {
    try {
      await sendEntry(entry);
      await removeFromOutbox(entry.id, db);
      sent += 1;
    } catch (error) {
      if (error instanceof ApiError && error.requiresReauthentication) throw error;

      if (isRetryable(error)) {
        await recordRetryableFailure(entry.id, describe(error), db);
        // Stop here: the network is down, and the entries behind this one depend on it.
        break;
      }

      // The server has given a final answer — an impossible score, a deleted opponent.
      // Retrying cannot change it, so the entry is parked and the queue moves on.
      await recordPermanentFailure(entry.id, describe(error), db);
    }
  }

  return sent;
}

async function sendEntry(entry: OutboxEntry): Promise<void> {
  await request(entry.endpoint, {
    method: entry.method,
    body: entry.method === 'DELETE' ? undefined : entry.body,
    // The same key on every attempt is the whole mechanism: it is what lets the server
    // recognise a replay rather than create a second match.
    idempotencyKey: entry.idempotencyKey,
  });
}

/**
 * Pulls everything changed since the last completed run.
 *
 * The cursor is only advanced past a page once that page's records are in the database,
 * and `syncedAt` is only stored when the server reports the run complete. Storing it
 * mid-run would skip every page not yet fetched.
 */
async function pull(db: SQLiteDatabase): Promise<number> {
  const since = await readState(SYNC_STATE_KEYS.lastSyncedAt, db);
  let cursor = await readState(SYNC_STATE_KEYS.pendingCursor, db);
  let received = 0;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
    const response = await request<SyncPullResponse>('/sync/pull', {
      query: {
        // A run in progress continues from its cursor; `since` only starts a new one.
        ...(cursor ? { cursor } : since ? { since } : {}),
        limit: 200,
      },
    });

    await applyPage(response, db);

    received +=
      response.changed.matches.length +
      response.changed.sessions.length +
      response.changed.players.length +
      response.changed.venues.length;

    if (!response.hasMore) {
      await writeState(SYNC_STATE_KEYS.lastSyncedAt, response.syncedAt, db);
      await writeState(SYNC_STATE_KEYS.pendingCursor, null, db);
      await writeServerCounts(response.counts, db);
      return received;
    }

    cursor = response.cursor;
    // Persisted so a run interrupted by the app being backgrounded resumes where it
    // stopped instead of starting the whole history again.
    await writeState(SYNC_STATE_KEYS.pendingCursor, cursor, db);
  }

  return received;
}

async function applyPage(response: SyncPullResponse, db: SQLiteDatabase): Promise<void> {
  // Players and venues first: a match references them, and a match card that arrives
  // before its opponent has a name renders as "Unknown" until the next pull.
  await upsertPlayers(response.changed.players, db);
  await upsertVenues(response.changed.venues, db);
  await upsertSessions(response.changed.sessions, db);
  await upsertMatches(response.changed.matches, db);
}

/**
 * Whether the local cache has drifted from the server.
 *
 * Deletions are not tracked with tombstones, so a match deleted on another device would
 * otherwise linger here forever. Comparing counts catches that: cheap enough to run on
 * every launch, and a mismatch is the signal to rebuild from scratch.
 */
export async function hasDiverged(db?: SQLiteDatabase): Promise<boolean> {
  const database = db ?? (await getDatabase());

  const [expected, actual] = await Promise.all([readServerCounts(database), localCounts(database)]);
  if (!expected) return false;

  // Only a local *surplus* means divergence. A shortfall is the ordinary state of a sync
  // that has not finished pulling yet, and treating it as drift would make a first sync
  // restart itself forever.
  return (
    actual.matches > expected.matches ||
    actual.sessions > expected.sessions ||
    actual.players > expected.players ||
    actual.venues > expected.venues
  );
}

/**
 * Asks the server what it holds, without transferring any records.
 *
 * Cheap enough for every launch, and the answer is what tells the app whether a full
 * re-pull is needed.
 */
export async function fetchStatus(): Promise<SyncStatusResponse> {
  return request<SyncStatusResponse>('/sync/status');
}

/**
 * Discards the cursor so the next sync re-reads everything.
 *
 * The cache is left in place deliberately. Clearing it would empty the history screen
 * for as long as the re-pull takes; upserting over it instead means the user sees stale
 * data briefly rather than no data at all.
 */
export async function resetSyncCursor(db?: SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());
  await writeState(SYNC_STATE_KEYS.lastSyncedAt, null, database);
  await writeState(SYNC_STATE_KEYS.pendingCursor, null, database);
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Test seam: clears the single-flight guard between cases. */
export function __resetSyncState(): void {
  running = null;
}
