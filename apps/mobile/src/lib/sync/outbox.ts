import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../db/database';
import type { OutboxKind, OutboxStatus } from '../db/schema';

/**
 * The outbox: writes the user has made that the server has not accepted yet.
 *
 * This is the only table holding data that exists nowhere else. Everything else in the
 * local database is a copy of something the server already has and can be rebuilt; an
 * outbox entry is a match somebody played, and losing it loses the match.
 *
 * The design rests on one rule: **the idempotency key is generated once, when the entry
 * is queued, and never regenerated on retry.** That single decision is what makes a
 * retry safe. Without it, the dangerous case is not a failed request but a successful one
 * whose response was lost — the phone cannot tell those apart, retries, and creates a
 * second match. With it, the server recognises the replay and returns the original result.
 */

export interface OutboxEntry {
  id: string;
  kind: OutboxKind;
  /** The record this operation concerns, when it has one. */
  entityId: string | null;
  endpoint: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body: unknown;
  idempotencyKey: string;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  status: OutboxStatus;
  createdAt: string;
  updatedAt: string;
}

interface OutboxRow {
  id: string;
  kind: OutboxKind;
  entity_id: string | null;
  endpoint: string;
  method: OutboxEntry['method'];
  body: string;
  idempotency_key: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  status: OutboxStatus;
  created_at: string;
  updated_at: string;
}

/**
 * How long to wait before attempt number `n`.
 *
 * Exponential with a ceiling, because the common reason for failure is being somewhere
 * with no signal, and that is not resolved by asking more often. The ceiling of five
 * minutes means a phone that regains signal syncs promptly without the queue having
 * backed off to hours.
 */
const BACKOFF_SECONDS = [0, 2, 5, 15, 45, 120, 300] as const;
const MAX_BACKOFF_SECONDS = 300;

/**
 * Attempts after which an entry stops being retried automatically.
 *
 * It is not deleted — it is marked `FAILED` and surfaced, because the alternative is
 * silently discarding somebody's match. The user decides whether to retry or drop it.
 */
export const MAX_ATTEMPTS = 12;

export function backoffSecondsFor(attempts: number): number {
  return BACKOFF_SECONDS[attempts] ?? MAX_BACKOFF_SECONDS;
}

/** A key the server will accept: URL-safe, and comfortably inside its 16–128 bounds. */
export function newIdempotencyKey(): string {
  return `obx-${Crypto.randomUUID()}`;
}

/** A client-generated id the server adopts, so nothing has to be renumbered on sync. */
export function newEntityId(): string {
  return Crypto.randomUUID();
}

export async function enqueue(
  entry: Pick<OutboxEntry, 'kind' | 'entityId' | 'endpoint' | 'method' | 'body'>,
  db?: SQLiteDatabase,
): Promise<OutboxEntry> {
  const database = db ?? (await getDatabase());
  const now = new Date().toISOString();

  const queued: OutboxEntry = {
    id: Crypto.randomUUID(),
    ...entry,
    idempotencyKey: newIdempotencyKey(),
    attempts: 0,
    // Ready immediately: the drain loop decides whether the network is up, not this.
    nextAttemptAt: now,
    lastError: null,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
  };

  await database.runAsync(
    `INSERT INTO outbox (
       id, kind, entity_id, endpoint, method, body, idempotency_key,
       attempts, next_attempt_at, last_error, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      queued.id,
      queued.kind,
      queued.entityId,
      queued.endpoint,
      queued.method,
      JSON.stringify(queued.body),
      queued.idempotencyKey,
      queued.attempts,
      queued.nextAttemptAt,
      queued.lastError,
      queued.status,
      queued.createdAt,
      queued.updatedAt,
    ],
  );

  return queued;
}

/**
 * Entries ready to send, oldest first.
 *
 * Order matters and is not merely tidy: an entry that updates a match must not be sent
 * before the entry that creates it. Insertion order is causal order because the UI
 * queues operations in the order the user performs them.
 */
export async function claimReady(limit = 20, db?: SQLiteDatabase): Promise<OutboxEntry[]> {
  const database = db ?? (await getDatabase());

  const rows = await database.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox
      WHERE status = 'PENDING' AND next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT ?`,
    [new Date().toISOString(), limit],
  );

  return rows.map(toEntry);
}

/** Everything still queued or failed, for the "unsynced" indicator and the settings screen. */
export async function listAll(db?: SQLiteDatabase): Promise<OutboxEntry[]> {
  const database = db ?? (await getDatabase());
  const rows = await database.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox ORDER BY created_at ASC`,
  );
  return rows.map(toEntry);
}

export async function countPending(db?: SQLiteDatabase): Promise<number> {
  const database = db ?? (await getDatabase());
  const row = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM outbox WHERE status = 'PENDING'`,
  );
  return row?.count ?? 0;
}

export async function countFailed(db?: SQLiteDatabase): Promise<number> {
  const database = db ?? (await getDatabase());
  const row = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM outbox WHERE status = 'FAILED'`,
  );
  return row?.count ?? 0;
}

/** The server accepted it. The entry has done its job and goes away. */
export async function remove(id: string, db?: SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());
  await database.runAsync(`DELETE FROM outbox WHERE id = ?`, [id]);
}

/**
 * Records a failure worth retrying and schedules the next attempt.
 *
 * Past `MAX_ATTEMPTS` the entry is parked as `FAILED` rather than deleted: something is
 * wrong that retrying will not fix, and the person who played the match should be the one
 * who decides what happens to it.
 */
export async function recordRetryableFailure(
  id: string,
  error: string,
  db?: SQLiteDatabase,
): Promise<void> {
  const database = db ?? (await getDatabase());
  const now = new Date();

  const row = await database.getFirstAsync<{ attempts: number }>(
    `SELECT attempts FROM outbox WHERE id = ?`,
    [id],
  );
  if (!row) return;

  const attempts = row.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  const nextAttemptAt = new Date(now.getTime() + backoffSecondsFor(attempts) * 1000);

  await database.runAsync(
    `UPDATE outbox
        SET attempts = ?, last_error = ?, status = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ?`,
    [
      attempts,
      error,
      exhausted ? 'FAILED' : 'PENDING',
      nextAttemptAt.toISOString(),
      now.toISOString(),
      id,
    ],
  );
}

/**
 * Records a failure that retrying cannot fix — an impossible score, a validation error.
 *
 * Parked immediately rather than after twelve identical rejections, because the server
 * has already given its final answer and the queue behind this entry should not wait.
 */
export async function recordPermanentFailure(
  id: string,
  error: string,
  db?: SQLiteDatabase,
): Promise<void> {
  const database = db ?? (await getDatabase());
  const now = new Date().toISOString();

  await database.runAsync(
    `UPDATE outbox
        SET attempts = attempts + 1, last_error = ?, status = 'FAILED', updated_at = ?
      WHERE id = ?`,
    [error, now, id],
  );
}

/**
 * Puts a failed entry back in the queue at the user's request.
 *
 * The idempotency key is deliberately preserved. If the original attempt actually did
 * reach the server, this retry returns that same match rather than creating a second one.
 */
export async function retryFailed(id: string, db?: SQLiteDatabase): Promise<void> {
  const database = db ?? (await getDatabase());
  const now = new Date().toISOString();

  await database.runAsync(
    `UPDATE outbox
        SET status = 'PENDING', attempts = 0, next_attempt_at = ?, last_error = NULL, updated_at = ?
      WHERE id = ? AND status = 'FAILED'`,
    [now, now, id],
  );
}

/** Time until the earliest pending entry is due, or null when nothing is waiting. */
export async function millisecondsUntilNextAttempt(db?: SQLiteDatabase): Promise<number | null> {
  const database = db ?? (await getDatabase());

  const row = await database.getFirstAsync<{ next_attempt_at: string }>(
    `SELECT next_attempt_at FROM outbox
      WHERE status = 'PENDING'
      ORDER BY next_attempt_at ASC
      LIMIT 1`,
  );
  if (!row) return null;

  return Math.max(0, new Date(row.next_attempt_at).getTime() - Date.now());
}

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    id: row.id,
    kind: row.kind,
    entityId: row.entity_id,
    endpoint: row.endpoint,
    method: row.method,
    body: JSON.parse(row.body) as unknown,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
