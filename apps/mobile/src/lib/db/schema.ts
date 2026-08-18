/**
 * The local database.
 *
 * Two distinct jobs live here, and keeping them separate is what makes the offline story
 * work:
 *
 *  - **The cache** (`matches`, `sessions`, `players`, `venues`) is a read-only mirror of
 *    the server, refreshed by sync. Nothing in the app writes to it except the sync
 *    engine, and it can be deleted and rebuilt at any time without losing anything.
 *
 *  - **The outbox** (`outbox`) is the opposite: writes the user has made that the server
 *    has not accepted yet. It is the only table holding data that exists nowhere else, so
 *    it is the only table whose loss would lose a match.
 *
 * A row can be in both — a match recorded offline appears in the cache immediately, so it
 * shows in the history straight away, and in the outbox until the server confirms it.
 * `pending_local` on the cached row is what tells the UI to mark it as not yet synced.
 *
 * Server ids are the primary keys, because reconciling two id spaces is a class of bug
 * this design simply avoids. A match created offline gets a locally generated UUID that
 * the server then adopts as its own id, so nothing has to be renumbered on sync.
 */

export const SCHEMA_VERSION = 1;

/**
 * Migrations, applied in order and recorded by `PRAGMA user_version`.
 *
 * Each entry is immutable once released: a user upgrading from any older version replays
 * exactly the statements a new install runs, so editing an existing migration would give
 * the two different schemas. New changes go in a new entry.
 */
export const MIGRATIONS: ReadonlyArray<{ version: number; statements: readonly string[] }> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS players (
         id             TEXT PRIMARY KEY NOT NULL,
         name           TEXT NOT NULL,
         nickname       TEXT,
         relationship   TEXT,
         is_self        INTEGER NOT NULL DEFAULT 0,
         rating         REAL,
         updated_at     TEXT NOT NULL,
         pending_local  INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS players_name_idx ON players (name COLLATE NOCASE)`,

      `CREATE TABLE IF NOT EXISTS venues (
         id             TEXT PRIMARY KEY NOT NULL,
         name           TEXT NOT NULL,
         city           TEXT,
         is_favourite   INTEGER NOT NULL DEFAULT 0,
         updated_at     TEXT NOT NULL,
         pending_local  INTEGER NOT NULL DEFAULT 0
       )`,

      `CREATE TABLE IF NOT EXISTS sessions (
         id             TEXT PRIMARY KEY NOT NULL,
         date           TEXT NOT NULL,
         session_type   TEXT NOT NULL,
         started_at     TEXT,
         ended_at       TEXT,
         notes          TEXT,
         venue_id       TEXT,
         venue_name     TEXT,
         updated_at     TEXT NOT NULL,
         pending_local  INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS sessions_date_idx ON sessions (date DESC)`,

      // `payload` holds the full match as the API returned it. The columns beside it are
      // duplicated out of that JSON purely so the list and filter queries can be indexed;
      // the payload stays authoritative, so adding a field to the API does not require a
      // migration here.
      `CREATE TABLE IF NOT EXISTS matches (
         id             TEXT PRIMARY KEY NOT NULL,
         session_id     TEXT NOT NULL,
         played_at      TEXT NOT NULL,
         discipline     TEXT NOT NULL,
         result         TEXT NOT NULL,
         venue_id       TEXT,
         opponent_ids   TEXT NOT NULL DEFAULT '',
         partner_ids    TEXT NOT NULL DEFAULT '',
         payload        TEXT NOT NULL,
         updated_at     TEXT NOT NULL,
         pending_local  INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS matches_played_at_idx ON matches (played_at DESC)`,
      `CREATE INDEX IF NOT EXISTS matches_session_idx ON matches (session_id)`,
      `CREATE INDEX IF NOT EXISTS matches_pending_idx ON matches (pending_local) WHERE pending_local = 1`,

      // The outbox. `idempotency_key` is generated when the entry is queued, never on
      // retry — that is the whole mechanism: the same key on every attempt is what lets
      // the server recognise a replay instead of creating a duplicate.
      `CREATE TABLE IF NOT EXISTS outbox (
         id               TEXT PRIMARY KEY NOT NULL,
         kind             TEXT NOT NULL,
         entity_id        TEXT,
         endpoint         TEXT NOT NULL,
         method           TEXT NOT NULL,
         body             TEXT NOT NULL,
         idempotency_key  TEXT NOT NULL,
         attempts         INTEGER NOT NULL DEFAULT 0,
         next_attempt_at  TEXT NOT NULL,
         last_error       TEXT,
         status           TEXT NOT NULL DEFAULT 'PENDING',
         created_at       TEXT NOT NULL,
         updated_at       TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS outbox_ready_idx ON outbox (status, next_attempt_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS outbox_key_idx ON outbox (idempotency_key)`,

      // Single-row table holding sync bookkeeping. A key/value shape rather than columns,
      // so a new cursor field does not need a migration.
      `CREATE TABLE IF NOT EXISTS sync_state (
         key    TEXT PRIMARY KEY NOT NULL,
         value  TEXT
       )`,
    ],
  },
];

/** Rows in `sync_state`, named so a typo cannot silently create a new setting. */
export const SYNC_STATE_KEYS = {
  /** Server timestamp of the last completed sync run, sent as `since` on the next one. */
  lastSyncedAt: 'lastSyncedAt',
  /** Cursor for a run that has not finished paging yet. */
  pendingCursor: 'pendingCursor',
  /** Server record counts at the last sync, compared to detect deletions elsewhere. */
  serverCounts: 'serverCounts',
  /** Installation id for this app instance, registered with the API as a device. */
  installationId: 'installationId',
} as const;

export type SyncStateKey = (typeof SYNC_STATE_KEYS)[keyof typeof SYNC_STATE_KEYS];

export type OutboxStatus = 'PENDING' | 'FAILED';

export type OutboxKind =
  'CREATE_MATCH' | 'UPDATE_MATCH' | 'DELETE_MATCH' | 'CREATE_PLAYER' | 'UPDATE_SESSION';
