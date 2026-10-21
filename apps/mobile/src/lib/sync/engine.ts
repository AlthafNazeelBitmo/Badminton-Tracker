import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  SyncManifestResponse,
  SyncPullResponse,
  SyncStatusResponse,
} from '@badminton/contracts';
import { request } from '../api/client';
import { ApiError, isRetryable } from '../api/errors';
import { getDatabase } from '../db/database';
import {
  confirmedCounts,
  pruneOrphanedLocalPlayers,
  removeMissing,
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
    const result = await pull(database);
    pulled = result.received;

    // Only once the run has completed: mid-run, the server's version of a match may not
    // have arrived yet, and the cache would be judged against half the picture.
    if (result.complete) await reconcile(database);
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
  try {
    await request(entry.endpoint, {
      method: entry.method,
      body: entry.method === 'DELETE' ? undefined : entry.body,
      // The same key on every attempt is the whole mechanism: it is what lets the server
      // recognise a replay rather than create a second match.
      idempotencyKey: entry.idempotencyKey,
    });
  } catch (error) {
    if (await alreadyApplied(entry, error)) return;
    throw error;
  }
}

/**
 * Whether a refused create was refused because it already succeeded.
 *
 * The server forgets idempotency keys after 48 hours. A phone that comes back online
 * after that, retrying a match whose first attempt did land, no longer gets the original
 * response replayed — it gets `409 DUPLICATE`, because the match id it assigned is taken.
 * That is the right outcome (still one match), but parking it as a failure would tell the
 * user a saved match "could not be saved".
 *
 * So the id is looked up. Found means it is ours and it is there: delivered. Not found
 * means the conflict is something else, and the original refusal stands.
 */
async function alreadyApplied(entry: OutboxEntry, error: unknown): Promise<boolean> {
  if (!(error instanceof ApiError) || error.status !== 409 || error.code !== 'DUPLICATE') {
    return false;
  }
  if (entry.kind !== 'CREATE_MATCH' || !entry.entityId) return false;

  try {
    await request(`/matches/${entry.entityId}`);
    return true;
  } catch (lookup) {
    if (lookup instanceof ApiError && lookup.status === 404) return false;
    // Offline mid-check: retryable, so the entry is simply tried again later.
    throw lookup;
  }
}

/**
 * Pulls everything changed since the last completed run.
 *
 * The cursor is only advanced past a page once that page's records are in the database,
 * and `syncedAt` is only stored when the server reports the run complete. Storing it
 * mid-run would skip every page not yet fetched.
 */
async function pull(db: SQLiteDatabase): Promise<{ received: number; complete: boolean }> {
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
      return { received, complete: true };
    }

    cursor = response.cursor;
    // Persisted so a run interrupted by the app being backgrounded resumes where it
    // stopped instead of starting the whole history again.
    await writeState(SYNC_STATE_KEYS.pendingCursor, cursor, db);
  }

  // Page budget spent with more to come; the next sync resumes from the stored cursor.
  return { received, complete: false };
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
 * Tidies the cache after a completed pull.
 *
 * Two kinds of leftover, both of which used to stay for good:
 *
 *  - **Players the server declined.** A player named offline whom the server matched to
 *    someone it already knew. Pruned once no match refers to them.
 *  - **Records deleted on another device.** Deletions are not sent as tombstones, so the
 *    counts are compared and, only on a surplus, the server's list of ids is fetched and
 *    anything confirmed but missing from it is dropped.
 */
async function reconcile(db: SQLiteDatabase): Promise<void> {
  await pruneOrphanedLocalPlayers(db);

  if (!(await hasDiverged(db))) return;

  const manifest = await request<SyncManifestResponse>('/sync/manifest');

  // Deleting on the strength of a malformed answer would empty the cache. Doing nothing
  // leaves stale rows, which the next sync gets another chance to fix.
  const lists = [manifest.matchIds, manifest.sessionIds, manifest.playerIds, manifest.venueIds];
  if (!lists.every(Array.isArray)) return;

  await removeMissing(manifest, db);
}

/**
 * Whether the local cache holds records the server no longer has.
 *
 * Deletions are not tracked with tombstones, so a match deleted on another device would
 * otherwise linger here forever. Comparing counts catches that cheaply; the manifest then
 * says which records to drop. Only confirmed rows are counted — a match still waiting to
 * upload is not on the server yet, and would otherwise read as a surplus.
 */
export async function hasDiverged(db?: SQLiteDatabase): Promise<boolean> {
  const database = db ?? (await getDatabase());

  const [expected, actual] = await Promise.all([
    readServerCounts(database),
    confirmedCounts(database),
  ]);
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
 * Cheap enough for every launch. Each completed pull already carries the same counts, so
 * the sync engine does not need this; it is here for a settings or diagnostics screen.
 */
export async function fetchStatus(): Promise<SyncStatusResponse> {
  return request<SyncStatusResponse>('/sync/status');
}

/**
 * Discards the cursor so the next sync re-reads everything.
 *
 * The cache is left in place deliberately. Clearing it would empty the history screen
 * for as long as the next pull takes; upserting over it instead means the user sees stale
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
