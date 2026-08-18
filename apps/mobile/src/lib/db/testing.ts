import * as SQLite from 'expo-sqlite';
import { migrate } from './database';

/**
 * A real, migrated, in-memory database for tests.
 *
 * Deliberately the actual SQLite engine running the actual migrations, not a mock. The
 * bugs worth catching in this layer are SQL bugs — a wrong index, a comparison against a
 * string date, a transaction that does not roll back — and a mock cannot have those.
 */
export async function createTestDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(':memory:');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
  return db;
}
