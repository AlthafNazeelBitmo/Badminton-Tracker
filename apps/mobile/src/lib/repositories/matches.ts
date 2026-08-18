import type { SQLiteDatabase } from 'expo-sqlite';
import {
  DEFAULT_SCORING_RULES,
  validateMatchGames,
  type Discipline,
  type PerformanceTag,
  type ScoringRules,
  type SessionType,
  type SyncMatch,
} from '@badminton/contracts';
import { deriveMatch } from '@badminton/analytics';
import { getDatabase } from '../db/database';
import { insertLocalPlayer, listMatches, upsertLocalMatch, type CachedMatch } from '../db/cache';
import { enqueue, newEntityId } from '../sync/outbox';

/**
 * Recording a match.
 *
 * The design goal from the specification is that this takes twenty to thirty seconds at
 * the side of a court, which rules out waiting for a network round trip: courts are
 * indoors, often in basements, and the connection is frequently absent. So the write is
 * local and immediate, and the network is somebody else's problem afterwards.
 *
 * Three things happen in one transaction:
 *
 *  1. Any new opponent or partner is written to the local player table with a
 *     device-generated id, which the server later adopts as its own.
 *  2. The match is written to the cache, marked pending, so the history screen shows it
 *     at once.
 *  3. An outbox entry is queued, carrying the idempotency key that makes its eventual
 *     delivery safe to retry.
 *
 * Either all three land or none do. A match in the cache with no outbox entry would look
 * saved and never reach the server — the worst of the available failures, because nothing
 * would ever tell the user.
 */

export interface RecordMatchInput {
  discipline: Discipline;
  session: {
    date: string;
    sessionType: SessionType;
    venueId?: string | null;
    venueName?: string | null;
  };
  /** Either an existing player id or a name to create. */
  partners: Array<{ id?: string; name?: string }>;
  opponents: Array<{ id?: string; name?: string }>;
  games: Array<{ myScore: number; opponentScore: number }>;
  scoring?: ScoringRules;
  playedAt?: string;
  durationSeconds?: number | null;
  difficulty?: number | null;
  energyLevel?: number | null;
  confidence?: number | null;
  feeling?: number | null;
  notes?: string | null;
  tags?: PerformanceTag[];
}

export class InvalidMatchError extends Error {
  constructor(readonly issues: Array<{ code: string; message: string; gameIndex?: number }>) {
    super(issues[0]?.message ?? 'The match could not be saved.');
    this.name = 'InvalidMatchError';
  }
}

export interface RecordedMatch {
  match: CachedMatch;
  outboxEntryId: string;
}

export async function recordMatch(
  input: RecordMatchInput,
  db?: SQLiteDatabase,
): Promise<RecordedMatch> {
  const database = db ?? (await getDatabase());
  const scoring = input.scoring ?? DEFAULT_SCORING_RULES;

  // Validated with the same function the server uses, so an impossible score is caught
  // here rather than being queued, sent, rejected, and surfaced minutes later when the
  // user is no longer at the court and cannot remember the real score.
  const validation = validateMatchGames(input.games, scoring);
  if (!validation.valid) throw new InvalidMatchError(validation.issues);

  const playedAt = input.playedAt ?? new Date().toISOString();
  const matchId = newEntityId();
  const sessionId = newEntityId();

  const partners = input.partners.map(resolveParticipant);
  const opponents = input.opponents.map(resolveParticipant);

  const derived = deriveMatch({ scoring, games: input.games });

  const match: SyncMatch = {
    id: matchId,
    sessionId,
    playedAt,
    orderInSession: 1,
    discipline: input.discipline,
    scoring,
    durationSeconds: input.durationSeconds ?? null,
    difficulty: input.difficulty ?? null,
    energyLevel: input.energyLevel ?? null,
    confidence: input.confidence ?? null,
    feeling: input.feeling ?? null,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
    venue: input.session.venueId
      ? { id: input.session.venueId, name: input.session.venueName ?? '' }
      : null,
    partnerIds: partners.map((person) => person.id),
    opponentIds: opponents.map((person) => person.id),
    partnerNames: partners.map((person) => person.name),
    opponentNames: opponents.map((person) => person.name),
    games: input.games.map((game, index) => ({ gameNumber: index + 1, ...game })),
    derived,
    updatedAt: playedAt,
  };

  // The server takes names or ids interchangeably and resolves them itself, so a player
  // created here needs no separate round trip — and, crucially, no ordering dependency
  // between two outbox entries that could be delivered apart.
  const body = {
    id: matchId,
    discipline: input.discipline,
    session: {
      id: sessionId,
      date: input.session.date,
      sessionType: input.session.sessionType,
      ...(input.session.venueId ? { venueId: input.session.venueId } : {}),
    },
    partners: partners.map(toParticipantInput),
    opponents: opponents.map(toParticipantInput),
    games: input.games,
    scoring,
    playedAt,
    ...(input.durationSeconds != null ? { durationSeconds: input.durationSeconds } : {}),
    ...(input.difficulty != null ? { difficulty: input.difficulty } : {}),
    ...(input.energyLevel != null ? { energyLevel: input.energyLevel } : {}),
    ...(input.confidence != null ? { confidence: input.confidence } : {}),
    ...(input.feeling != null ? { feeling: input.feeling } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.tags?.length ? { tags: input.tags } : {}),
  };

  let outboxEntryId = '';

  await database.withExclusiveTransactionAsync(async (tx) => {
    for (const person of [...partners, ...opponents]) {
      if (person.isNew) await insertLocalPlayer({ id: person.id, name: person.name }, tx);
    }

    await upsertLocalMatch(match, tx);

    const entry = await enqueue(
      {
        kind: 'CREATE_MATCH',
        entityId: matchId,
        endpoint: '/matches',
        method: 'POST',
        body,
      },
      tx,
    );
    outboxEntryId = entry.id;
  });

  const stored = await listMatches({ limit: 1 }, database);
  return {
    match: stored.find((candidate) => candidate.id === matchId) ?? { ...match, pendingLocal: true },
    outboxEntryId,
  };
}

interface ResolvedParticipant {
  id: string;
  name: string;
  isNew: boolean;
}

function resolveParticipant(person: { id?: string; name?: string }): ResolvedParticipant {
  if (person.id) return { id: person.id, name: person.name ?? '', isNew: false };

  const name = person.name?.trim();
  if (!name) throw new InvalidMatchError([{ code: 'PLAYER_REQUIRED', message: 'Name a player.' }]);

  // A device-generated id the server adopts. Without it the match could not reference a
  // brand-new opponent until the server had replied, which is exactly what recording
  // offline has to work without.
  return { id: newEntityId(), name, isNew: true };
}

/**
 * A participant as the API expects it.
 *
 * An existing player is referenced by `playerId` alone — sending a name too invites the
 * server to resolve on it and create a second record for someone whose name was typed
 * slightly differently. A new player sends the name plus the id this device assigned,
 * which the server adopts.
 */
function toParticipantInput(
  person: ResolvedParticipant,
): { playerId: string } | { name: string; id: string } {
  return person.isNew ? { name: person.name, id: person.id } : { playerId: person.id };
}
