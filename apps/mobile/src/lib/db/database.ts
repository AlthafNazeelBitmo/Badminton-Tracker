import * as SQLite from 'expo-sqlite';
import { MIGRATIONS } from './schema';

/**
 * Opens the local database and brings its schema up to date.
 *
 * One connection for the life of the process. `expo-sqlite` serialises statements on a
 * single connection, which removes a whole category of concurrency bug: the sync engine
 * writing the cache while a screen reads it cannot interleave badly.
 */

let database: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

const DATABASE_NAME = 'badminton.db';

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;

  // Several screens can mount at once on a cold start and all ask for the database. One
  // open, everyone waits on it.
  opening ??= openAndMigrate();

  try {
    database = await opening;
    return database;
  } finally {
    opening = null;
  }
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
  `);

  await migrate(db);
  return db;
}

/**
 * Applies any migrations the database has not seen.
 *
 * `user_version` is SQLite's own integer field for exactly this, so the schema version
 * travels with the file and needs no table of its own. Each migration runs inside a
 * transaction with the version bump, so a failure part-way leaves the database on the
 * previous version rather than in a state that is neither.
 */
export async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;

    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const statement of migration.statements) {
        await tx.execAsync(statement);
      }
      // PRAGMA does not accept a bound parameter. The value is a number from a constant
      // in this repository, never user input.
      await tx.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

/**
 * Closes and forgets the connection.
 *
 * Used when signing out, where the point is that the next user of the device cannot read
 * the previous one's matches out of a cache that was merely hidden.
 */
export async function closeDatabase(): Promise<void> {
  const open = database;
  database = null;
  opening = null;
  if (open) await open.closeAsync();
}

/**
 * Deletes every row the account owns, leaving the schema in place.
 *
 * Called on sign-out. Dropping the file instead would be simpler, but leaves a window
 * where the app has no database at all and any query in flight throws.
 */
export async function clearLocalData(): Promise<void> {
  const db = await getDatabase();

  await db.withExclusiveTransactionAsync(async (tx) => {
    for (const table of ['matches', 'sessions', 'players', 'venues', 'outbox', 'sync_state']) {
      await tx.execAsync(`DELETE FROM ${table}`);
    }
  });
}

/** Test seam: lets a suite point at a fresh in-memory database per case. */
export function __setDatabaseForTests(db: SQLite.SQLiteDatabase | null): void {
  database = db;
  opening = null;
}
