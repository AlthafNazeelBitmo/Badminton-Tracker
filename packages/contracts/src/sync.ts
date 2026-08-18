import { z } from 'zod';
import { isoDateSchema } from './common';
import type { Discipline, PerformanceTag, PlayerRelationship, SessionType } from './enums';
import type { ScoringRules } from './scoring';
import type { MatchDerived } from './matches';

/**
 * Contracts for the offline queue.
 *
 * The mobile app records matches at the side of a court, where the connection is
 * frequently absent. Writes go into a local outbox and drain when the network returns.
 * Two properties make that safe:
 *
 *  1. **Idempotency.** Each queued operation carries a stable client-generated key,
 *     sent as the `Idempotency-Key` header. If the response to the first attempt was
 *     lost, the retry returns the original result rather than creating a second match.
 *  2. **Bounded staleness.** The client tells the server what it last saw, and the
 *     server replies with what has changed. No full re-download on every launch.
 */

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** How long the server remembers a key. A queue stuck longer than this has worse problems. */
export const IDEMPOTENCY_RETENTION_HOURS = 48;

export const idempotencyKeySchema = z
  .string()
  .min(16, 'An idempotency key must be at least 16 characters.')
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'An idempotency key must be URL-safe.');

/**
 * A delta since the client's last successful sync.
 *
 * Two parameters, with distinct jobs:
 *
 *  - **`since`** starts a run. It is the `syncedAt` from the last *completed* run — server
 *    time, never a client clock, because a device with a wrong clock would otherwise ask
 *    for changes since a moment that has not happened and silently skip records. The
 *    comparison is inclusive so a row written in the same millisecond the run started is
 *    re-sent rather than lost; the client upserts by id, so a duplicate costs nothing.
 *  - **`cursor`** continues a run. It is opaque — the client stores the string and hands
 *    it back while `hasMore` is true, and must not try to interpret it.
 *
 * A timestamp alone cannot page: a bulk import writes many rows with an identical
 * `updatedAt`, and a timestamp cursor either loops on them forever or steps over them.
 * The cursor carries a position within each collection instead.
 */
export const syncPullSchema = z.object({
  since: isoDateSchema.optional(),
  cursor: z.string().max(2048).optional(),
  /** Caps a first-time sync so a long history arrives in pages rather than one payload. */
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type SyncPullQuery = z.infer<typeof syncPullSchema>;

/** A match, flattened for the offline cache. */
export interface SyncMatch {
  id: string;
  sessionId: string;
  playedAt: string;
  orderInSession: number;
  discipline: Discipline;
  scoring: ScoringRules;
  durationSeconds: number | null;
  difficulty: number | null;
  energyLevel: number | null;
  confidence: number | null;
  feeling: number | null;
  notes: string | null;
  tags: PerformanceTag[];
  venue: { id: string; name: string } | null;
  partnerIds: string[];
  opponentIds: string[];
  /**
   * Participant names travel with the match so a cold cache can render a match card
   * before the player table has finished syncing.
   */
  partnerNames: Array<string | null>;
  opponentNames: Array<string | null>;
  games: Array<{ gameNumber: number; myScore: number; opponentScore: number }>;
  derived: MatchDerived;
  updatedAt: string;
}

export interface SyncSession {
  id: string;
  date: string;
  sessionType: SessionType;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  venue: { id: string; name: string; city: string | null } | null;
  updatedAt: string;
}

export interface SyncPlayer {
  id: string;
  name: string;
  nickname: string | null;
  relationship: PlayerRelationship | null;
  isSelf: boolean;
  rating: number | null;
  updatedAt: string;
}

export interface SyncVenue {
  id: string;
  name: string;
  city: string | null;
  isFavourite: boolean;
  updatedAt: string;
}

export interface SyncPullResponse {
  /**
   * Server time this run started. Store it as `since` for the next run, but only once
   * `hasMore` is false — storing it mid-run would skip the pages not yet fetched.
   */
  syncedAt: string;
  /** True when more records remain; pull again immediately, passing `cursor` back. */
  hasMore: boolean;
  /** Opaque continuation token. Non-null exactly when `hasMore` is true. */
  cursor: string | null;
  changed: {
    matches: SyncMatch[];
    sessions: SyncSession[];
    players: SyncPlayer[];
    venues: SyncVenue[];
  };
  /**
   * Ids removed since `since`, so the client can drop them from its cache. Currently
   * always empty: deletions are detected by comparing `counts` instead (see the service).
   */
  deleted: {
    matchIds: string[];
    sessionIds: string[];
    playerIds: string[];
    venueIds: string[];
  };
  counts: {
    matches: number;
    sessions: number;
    players: number;
    venues: number;
  };
}

/** Outcome of draining one queued operation, reported back for the client's log. */
export interface SyncOperationResult {
  idempotencyKey: string;
  status: 'APPLIED' | 'REPLAYED' | 'REJECTED';
  entityId: string | null;
  error: { code: string; message: string } | null;
}

export const syncStatusSchema = z.object({
  installationId: z.string().min(8).max(128).optional(),
});

export interface SyncStatusResponse {
  serverTime: string;
  /** Counts the client can compare against its own to detect a divergence. */
  totals: {
    matches: number;
    sessions: number;
    players: number;
    venues: number;
  };
  lastMatchAt: string | null;
}
