import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../db/database';
import { SYNC_STATE_KEYS, type SyncStateKey } from '../db/schema';

/**
 * Sync bookkeeping: where the last run got to, and what the server said it held.
 *
 * Stored in the database rather than in memory or `AsyncStorage` so that it is written in
 * the same transaction as the data it describes. A cursor that advanced without its
 * records landing would skip them permanently, and that is precisely the failure this
 * placement rules out.
 */

export async function readState(key: SyncStateKey, db?: SQLiteDatabase): Promise<string | null> {
  const database = db ?? (await getDatabase());
  const row = await database.getFirstAsync<{ value: string | null }>(
    `SELECT value FROM sync_state WHERE key = ?`,
    [key],
  );
  return row?.value ?? null;
}

export async function writeState(
  key: SyncStateKey,
  value: string | null,
  db?: SQLiteDatabase,
): Promise<void> {
  const database = db ?? (await getDatabase());
  await database.runAsync(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export interface ServerCounts {
  matches: number;
  sessions: number;
  players: number;
  venues: number;
}

export async function readServerCounts(db?: SQLiteDatabase): Promise<ServerCounts | null> {
  const raw = await readState(SYNC_STATE_KEYS.serverCounts, db);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ServerCounts;
  } catch {
    // Unreadable bookkeeping is not worth failing a sync over; the next run rewrites it.
    return null;
  }
}

export async function writeServerCounts(counts: ServerCounts, db?: SQLiteDatabase): Promise<void> {
  await writeState(SYNC_STATE_KEYS.serverCounts, JSON.stringify(counts), db);
}

/**
 * A stable id for this installation, generated once and kept.
 *
 * Identifies the device to the API so a push token can be attached to it and the user
 * can see and revoke it in settings. Deliberately random rather than a hardware
 * identifier: it is reset by reinstalling, which is exactly the behaviour a person would
 * expect, and it cannot be used to recognise them across apps.
 */
export async function getInstallationId(db?: SQLiteDatabase): Promise<string> {
  const existing = await readState(SYNC_STATE_KEYS.installationId, db);
  if (existing) return existing;

  const { randomUUID } = await import('expo-crypto');
  const id = randomUUID();
  await writeState(SYNC_STATE_KEYS.installationId, id, db);
  return id;
}
