/* eslint-disable @typescript-eslint/no-explicit-any */
import { DatabaseSync } from 'node:sqlite';

/**
 * `expo-sqlite`, backed by Node's built-in SQLite. **Test-only.**
 *
 * `expo-sqlite` is a native module with no JavaScript implementation, so it cannot run
 * under Jest. The usual answer is to mock it, but a mocked database cannot have SQL bugs,
 * and SQL bugs are precisely what this layer needs tested — a comparison against a string
 * date, an index that is never used, a transaction that fails to roll back.
 *
 * So this adapts Node 22's `node:sqlite` to the slice of the `expo-sqlite` API the app
 * uses. The SQL is executed by a real SQLite engine; only the wrapper differs. What this
 * does *not* cover is native-side behaviour — WAL mode, platform file locking, the
 * asynchronous driver's own queueing — so anything depending on those still has to be
 * checked on a device.
 *
 * Registered in `jest.setup.js`. Nothing in the app imports it.
 */

type Param = string | number | null;

function normalise(params: readonly unknown[]): Param[] {
  return params.map((value) => {
    if (value === undefined || value === null) return null;
    // `node:sqlite` rejects booleans outright; SQLite stores them as integers anyway,
    // which is exactly how the schema declares them.
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'number' || typeof value === 'string') return value;
    return String(value);
  });
}

class NodeStatementRunner {
  constructor(private readonly db: DatabaseSync) {}

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, params: readonly unknown[] = []): Promise<{ changes: number }> {
    const result = this.db.prepare(sql).run(...normalise(params));
    return { changes: Number(result.changes) };
  }

  async getFirstAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...normalise(params));
    // `node:sqlite` returns null-prototype objects, which fail `toEqual` against plain
    // object literals in a way that has nothing to do with the code under test.
    return row ? ({ ...row } as T) : null;
  }

  async getAllAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db
      .prepare(sql)
      .all(...normalise(params))
      .map((row) => ({ ...row }) as T);
  }
}

class NodeDatabase extends NodeStatementRunner {
  constructor(private readonly handle: DatabaseSync) {
    super(handle);
  }

  /**
   * Runs a function inside a transaction, rolling back if it throws.
   *
   * `BEGIN IMMEDIATE` matches what the native driver's exclusive transaction does: it
   * takes the write lock up front rather than on the first write, so a transaction cannot
   * fail half-way through for being unable to upgrade its lock.
   */
  async withExclusiveTransactionAsync(
    work: (tx: NodeStatementRunner) => Promise<void>,
  ): Promise<void> {
    this.handle.exec('BEGIN IMMEDIATE');
    try {
      await work(new NodeStatementRunner(this.handle));
      this.handle.exec('COMMIT');
    } catch (error) {
      this.handle.exec('ROLLBACK');
      throw error;
    }
  }

  async closeAsync(): Promise<void> {
    this.handle.close();
  }
}

export async function openDatabaseAsync(name: string): Promise<any> {
  // Every non-memory name also opens in memory: a test must never touch a real file, and
  // a suite that accidentally persisted state between runs would be maddening to debug.
  return new NodeDatabase(new DatabaseSync(name === ':memory:' ? ':memory:' : ':memory:'));
}

export function openDatabaseSync(name: string): any {
  return new NodeDatabase(new DatabaseSync(name === ':memory:' ? ':memory:' : ':memory:'));
}

export async function deleteDatabaseAsync(): Promise<void> {
  // In-memory databases vanish when closed; there is no file to remove.
}

export type SQLiteDatabase = NodeDatabase;
