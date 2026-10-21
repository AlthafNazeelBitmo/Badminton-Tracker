import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  SyncManifestResponse,
  SyncMatch,
  SyncPlayer,
  SyncSession,
  SyncVenue,
} from '@badminton/contracts';
import { getDatabase } from './database';

/**
 * The local read cache.
 *
 * A mirror of the server, written only by the sync engine and by the optimistic path
 * that shows a just-recorded match before it has been accepted. Every row here also
 * exists on the server (or is on its way there via the outbox), so the whole cache can be
 * deleted and rebuilt without losing anything.
 *
 * Writes are upserts keyed by the server's own id. That is what makes re-sending a record
 * harmless, and re-sending is deliberate: the sync window overlaps rather than risking a
 * gap.
 */

export interface CachedMatch extends SyncMatch {
  /** True while the match is still queued in the outbox, so the UI can mark it. */
  pendingLocal: boolean;
}

interface MatchRow {
  payload: string;
  pending_local: number;
}

export async function upsertMatches(
  matches: readonly SyncMatch[],
  db?: SQLiteDatabase,
): Promise<void> {
  if (matches.length === 0) return;
  const database = db ?? (await getDatabase());

  await database.withExclusiveTransactionAsync(async (tx) => {
    for (const match of matches) {
      await tx.runAsync(
        `INSERT INTO matches (
           id, session_id, played_at, discipline, result, venue_id,
           opponent_ids, partner_ids, payload, updated_at, pending_local
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           session_id   = excluded.session_id,
           played_at    = excluded.played_at,
           discipline   = excluded.discipline,
           result       = excluded.result,
           venue_id     = excluded.venue_id,
           opponent_ids = excluded.opponent_ids,
           partner_ids  = excluded.partner_ids,
           payload      = excluded.payload,
           updated_at   = excluded.updated_at,
           -- The server has confirmed this match, so it is no longer only local. This is
           -- what clears the "not yet synced" marker once the outbox entry lands.
           pending_local = 0`,
        [
          match.id,
          match.sessionId,
          match.playedAt,
          match.discipline,
          match.derived.result,
          match.venue?.id ?? null,
          match.opponentIds.join(','),
          match.partnerIds.join(','),
          JSON.stringify(match),
          match.updatedAt,
        ],
      );
    }
  });
}

/**
 * Stores a match the user just recorded, before the server has seen it.
 *
 * The point is that the history screen shows it immediately. Marked `pending_local` so
 * the UI can say it is not synced yet, and overwritten by the server's version — same id
 * — once the outbox entry succeeds.
 */
export async function upsertLocalMatch(match: SyncMatch, db?: SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());

  await database.runAsync(
    `INSERT INTO matches (
       id, session_id, played_at, discipline, result, venue_id,
       opponent_ids, partner_ids, payload, updated_at, pending_local
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload, updated_at = excluded.updated_at, pending_local = 1`,
    [
      match.id,
      match.sessionId,
      match.playedAt,
      match.discipline,
      match.derived.result,
      match.venue?.id ?? null,
      match.opponentIds.join(','),
      match.partnerIds.join(','),
      JSON.stringify(match),
      match.updatedAt,
    ],
  );
}

export async function deleteMatch(id: string, db?: SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());
  await database.runAsync(`DELETE FROM matches WHERE id = ?`, [id]);
}

export interface MatchQuery {
  limit?: number;
  offset?: number;
  opponentId?: string;
  discipline?: string;
  result?: string;
}

/**
 * Recent matches, newest first.
 *
 * Filters that need a participant use a delimited-string `LIKE`, which is not how a
 * server-side query would do it. It is right here: the alternative is a join table the
 * sync engine would have to keep consistent, and the whole cache is at most a few
 * thousand rows on a device that is only ever showing one person's own history.
 */
export async function listMatches(
  query: MatchQuery = {},
  db?: SQLiteDatabase,
): Promise<CachedMatch[]> {
  const database = db ?? (await getDatabase());

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.discipline) {
    conditions.push('discipline = ?');
    params.push(query.discipline);
  }
  if (query.result) {
    conditions.push('result = ?');
    params.push(query.result);
  }
  if (query.opponentId) {
    // Commas on both sides so `abc` cannot match `abcdef`.
    conditions.push("(',' || opponent_ids || ',') LIKE ?");
    params.push(`%,${query.opponentId},%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(query.limit ?? 50, query.offset ?? 0);

  const rows = await database.getAllAsync<MatchRow>(
    `SELECT payload, pending_local FROM matches
     ${where}
     ORDER BY played_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  return rows.map(toCachedMatch);
}

export async function getMatch(id: string, db?: SQLiteDatabase): Promise<CachedMatch | null> {
  const database = db ?? (await getDatabase());
  const row = await database.getFirstAsync<MatchRow>(
    `SELECT payload, pending_local FROM matches WHERE id = ?`,
    [id],
  );
  return row ? toCachedMatch(row) : null;
}

export async function countMatches(db?: SQLiteDatabase): Promise<number> {
  const database = db ?? (await getDatabase());
  const row = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM matches`,
  );
  return row?.count ?? 0;
}

export async function upsertPlayers(
  players: readonly SyncPlayer[],
  db?: SQLiteDatabase,
): Promise<void> {
  if (players.length === 0) return;
  const database = db ?? (await getDatabase());

  await database.withExclusiveTransactionAsync(async (tx) => {
    for (const player of players) {
      await tx.runAsync(
        `INSERT INTO players (id, name, nickname, relationship, is_self, rating, updated_at, pending_local)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, nickname = excluded.nickname,
           relationship = excluded.relationship, is_self = excluded.is_self,
           rating = excluded.rating, updated_at = excluded.updated_at, pending_local = 0`,
        [
          player.id,
          player.name,
          player.nickname,
          player.relationship,
          player.isSelf ? 1 : 0,
          player.rating,
          player.updatedAt,
        ],
      );
    }
  });
}

export interface CachedPlayer {
  id: string;
  name: string;
  nickname: string | null;
  isSelf: boolean;
  pendingLocal: boolean;
}

interface PlayerRow {
  id: string;
  name: string;
  nickname: string | null;
  is_self: number;
  pending_local: number;
}

/**
 * Players for the opponent and partner pickers.
 *
 * Excludes the user themselves: "who did you play against" never means you. Ordered by
 * name because the picker's own recency ordering is computed from match history, not
 * from this list.
 */
export async function listPlayers(search?: string, db?: SQLiteDatabase): Promise<CachedPlayer[]> {
  const database = db ?? (await getDatabase());

  const rows = search
    ? await database.getAllAsync<PlayerRow>(
        `SELECT id, name, nickname, is_self, pending_local FROM players
          WHERE is_self = 0 AND name LIKE ? COLLATE NOCASE
          ORDER BY name COLLATE NOCASE ASC`,
        [`%${search}%`],
      )
    : await database.getAllAsync<PlayerRow>(
        `SELECT id, name, nickname, is_self, pending_local FROM players
          WHERE is_self = 0
          ORDER BY name COLLATE NOCASE ASC`,
      );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    isSelf: row.is_self === 1,
    pendingLocal: row.pending_local === 1,
  }));
}

/**
 * Adds a player the user has just named, before the server has issued an id.
 *
 * The id is generated on the device and adopted by the server, so the match queued
 * alongside it can reference this player immediately and nothing needs renumbering.
 */
export async function insertLocalPlayer(
  player: { id: string; name: string },
  db?: SQLiteDatabase,
): Promise<void> {
  const database = db ?? (await getDatabase());
  await database.runAsync(
    `INSERT INTO players (id, name, nickname, relationship, is_self, rating, updated_at, pending_local)
     VALUES (?, ?, NULL, NULL, 0, NULL, ?, 1)
     ON CONFLICT(id) DO NOTHING`,
    [player.id, player.name, new Date().toISOString()],
  );
}

export async function upsertSessions(
  sessions: readonly SyncSession[],
  db?: SQLiteDatabase,
): Promise<void> {
  if (sessions.length === 0) return;
  const database = db ?? (await getDatabase());

  await database.withExclusiveTransactionAsync(async (tx) => {
    for (const session of sessions) {
      await tx.runAsync(
        `INSERT INTO sessions (id, date, session_type, started_at, ended_at, notes, venue_id, venue_name, updated_at, pending_local)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           date = excluded.date, session_type = excluded.session_type,
           started_at = excluded.started_at, ended_at = excluded.ended_at,
           notes = excluded.notes, venue_id = excluded.venue_id,
           venue_name = excluded.venue_name, updated_at = excluded.updated_at,
           pending_local = 0`,
        [
          session.id,
          session.date,
          session.sessionType,
          session.startedAt,
          session.endedAt,
          session.notes,
          session.venue?.id ?? null,
          session.venue?.name ?? null,
          session.updatedAt,
        ],
      );
    }
  });
}

export async function upsertVenues(
  venues: readonly SyncVenue[],
  db?: SQLiteDatabase,
): Promise<void> {
  if (venues.length === 0) return;
  const database = db ?? (await getDatabase());

  await database.withExclusiveTransactionAsync(async (tx) => {
    for (const venue of venues) {
      await tx.runAsync(
        `INSERT INTO venues (id, name, city, is_favourite, updated_at, pending_local)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, city = excluded.city,
           is_favourite = excluded.is_favourite, updated_at = excluded.updated_at,
           pending_local = 0`,
        [venue.id, venue.name, venue.city, venue.isFavourite ? 1 : 0, venue.updatedAt],
      );
    }
  });
}

export interface CachedVenue {
  id: string;
  name: string;
  city: string | null;
  isFavourite: boolean;
}

export async function listVenues(db?: SQLiteDatabase): Promise<CachedVenue[]> {
  const database = db ?? (await getDatabase());
  const rows = await database.getAllAsync<{
    id: string;
    name: string;
    city: string | null;
    is_favourite: number;
  }>(`SELECT id, name, city, is_favourite FROM venues ORDER BY is_favourite DESC, name ASC`);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    city: row.city,
    isFavourite: row.is_favourite === 1,
  }));
}

/** Local row counts, compared against the server's to detect a deletion made elsewhere. */
export async function localCounts(db?: SQLiteDatabase): Promise<{
  matches: number;
  sessions: number;
  players: number;
  venues: number;
}> {
  const database = db ?? (await getDatabase());

  const row = await database.getFirstAsync<{
    matches: number;
    sessions: number;
    players: number;
    venues: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM matches)  AS matches,
       (SELECT COUNT(*) FROM sessions) AS sessions,
       (SELECT COUNT(*) FROM players)  AS players,
       (SELECT COUNT(*) FROM venues)   AS venues`,
  );

  return row ?? { matches: 0, sessions: 0, players: 0, venues: 0 };
}

/**
 * Row counts for records the server has confirmed.
 *
 * What divergence detection compares against the server's own counts. A match recorded
 * offline is not on the server yet, so counting it would look like a surplus — and one
 * the server refused would look like a surplus for ever, sending every sync off to fetch
 * the manifest for nothing.
 */
export async function confirmedCounts(db?: SQLiteDatabase): Promise<{
  matches: number;
  sessions: number;
  players: number;
  venues: number;
}> {
  const database = db ?? (await getDatabase());

  const row = await database.getFirstAsync<{
    matches: number;
    sessions: number;
    players: number;
    venues: number;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM matches  WHERE pending_local = 0) AS matches,
       (SELECT COUNT(*) FROM sessions WHERE pending_local = 0) AS sessions,
       (SELECT COUNT(*) FROM players  WHERE pending_local = 0) AS players,
       (SELECT COUNT(*) FROM venues   WHERE pending_local = 0) AS venues`,
  );

  return row ?? { matches: 0, sessions: 0, players: 0, venues: 0 };
}

const RECONCILED_TABLES = ['matches', 'sessions', 'players', 'venues'] as const;

/**
 * Drops confirmed records the server no longer has: deleted on another device.
 *
 * Rows still waiting to upload are never touched. They are missing from the manifest
 * because the server has not seen them yet, not because anyone deleted them — removing
 * one would delete a match somebody just recorded.
 *
 * The ids go into a temporary table rather than a `NOT IN (?, ?, …)` list, which would
 * hit SQLite's bound-parameter limit on a long enough history.
 */
export async function removeMissing(
  manifest: Pick<SyncManifestResponse, 'matchIds' | 'sessionIds' | 'playerIds' | 'venueIds'>,
  db?: SQLiteDatabase,
): Promise<number> {
  const database = db ?? (await getDatabase());
  const lists: Record<(typeof RECONCILED_TABLES)[number], string[]> = {
    matches: manifest.matchIds,
    sessions: manifest.sessionIds,
    players: manifest.playerIds,
    venues: manifest.venueIds,
  };

  let removed = 0;

  await database.withExclusiveTransactionAsync(async (tx) => {
    await tx.execAsync(
      `CREATE TEMP TABLE IF NOT EXISTS manifest_ids (
         collection TEXT NOT NULL,
         id         TEXT NOT NULL,
         PRIMARY KEY (collection, id)
       )`,
    );
    await tx.execAsync('DELETE FROM manifest_ids');

    for (const table of RECONCILED_TABLES) {
      const ids = lists[table];
      for (let start = 0; start < ids.length; start += 200) {
        const chunk = ids.slice(start, start + 200);
        await tx.runAsync(
          `INSERT OR IGNORE INTO manifest_ids (collection, id) VALUES ${chunk.map(() => '(?, ?)').join(', ')}`,
          chunk.flatMap((id) => [table, id]),
        );
      }
    }

    for (const table of RECONCILED_TABLES) {
      // The table name comes from the constant above, never from input.
      const result = await tx.runAsync(
        `DELETE FROM ${table}
          WHERE pending_local = 0
            AND id NOT IN (SELECT id FROM manifest_ids WHERE collection = ?)`,
        [table],
      );
      removed += result.changes;
    }

    await tx.execAsync('DELETE FROM manifest_ids');
  });

  return removed;
}

/**
 * Removes players created offline that no match refers to any more.
 *
 * Name someone new while offline — "priya" — and the device creates a local player for
 * them. If the server already knew a "Priya", it keeps that one rather than splitting her
 * statistics across two records, and the next pull rewrites the match to point at her.
 * The local copy is then referenced by nothing, yet still shows in the picker beside the
 * real one.
 *
 * Only unconfirmed players are candidates, and only once no cached match mentions them.
 * A match still waiting to upload keeps its new players alive, so nothing is removed
 * before the server has had its say.
 */
export async function pruneOrphanedLocalPlayers(db?: SQLiteDatabase): Promise<number> {
  const database = db ?? (await getDatabase());

  const result = await database.runAsync(
    `DELETE FROM players
      WHERE pending_local = 1
        AND NOT EXISTS (
          SELECT 1 FROM matches
           WHERE (',' || matches.opponent_ids || ',') LIKE ('%,' || players.id || ',%')
              OR (',' || matches.partner_ids  || ',') LIKE ('%,' || players.id || ',%')
        )`,
  );

  return result.changes;
}

function toCachedMatch(row: MatchRow): CachedMatch {
  return {
    ...(JSON.parse(row.payload) as SyncMatch),
    pendingLocal: row.pending_local === 1,
  };
}
