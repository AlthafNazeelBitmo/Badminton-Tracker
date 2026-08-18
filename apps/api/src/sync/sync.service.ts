import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  SyncMatch,
  SyncPullQuery,
  SyncPullResponse,
  SyncStatusResponse,
} from '@badminton/contracts';
import { deriveMatch } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import {
  MATCH_RECORD_INCLUDE,
  toMatchRecord,
  type MatchWithRelations,
} from '../matches/match-record.loader';
import { AppException } from '../common/errors';

/** Where a collection was left off: the last row handed to the client. */
interface CollectionCursor {
  updatedAt: Date;
  id: string;
}

/** The full position of a paging run, encoded into the opaque `cursor` string. */
interface RunCursor {
  /** Server time the run started, so every page of a run reports the same `syncedAt`. */
  startedAt: Date;
  matches: CollectionCursor | null;
  sessions: CollectionCursor | null;
  players: CollectionCursor | null;
  venues: CollectionCursor | null;
}

type CollectionName = 'matches' | 'sessions' | 'players' | 'venues';

/**
 * The `where` fragment selecting the rows a collection still owes the client.
 *
 * Written structurally rather than as a Prisma type because it has to be assignable to
 * four different `WhereInput`s. All four models carry a `String` id and an `updatedAt`,
 * which is the only surface this touches.
 */
type UpdatedAtWindow =
  | Record<string, never>
  | { updatedAt: { gte: Date } }
  | { OR: Array<{ updatedAt: { gt: Date } } | { updatedAt: Date; id: { gt: string } }> };

const COLLECTIONS: CollectionName[] = ['matches', 'sessions', 'players', 'venues'];

/**
 * Delta sync for the mobile app.
 *
 * The app keeps a local copy so it can show your history at the side of a court with no
 * signal. Re-downloading everything on each launch would be slow and wasteful, so the
 * client says what it last saw and the server returns only what changed since.
 *
 * Three decisions make this correct rather than merely fast:
 *
 * **The starting point is server time, not client time.** A device with a skewed clock
 * would otherwise ask for changes since a moment that has not happened yet and silently
 * miss records. The client stores the `syncedAt` the server hands back and echoes it.
 *
 * **The starting comparison is inclusive.** `updatedAt > since` would drop a row written
 * in the same millisecond the run began. The client upserts by id, so re-sending a record
 * is harmless while losing one is not.
 *
 * **Paging uses a position, not a timestamp.** This is the subtle one. A CSV import writes
 * hundreds of rows carrying the same `updatedAt`; a timestamp cursor either returns them
 * forever or steps over the ones it did not reach. The cursor records `(updatedAt, id)`
 * per collection and compares on the pair, which totally orders the rows and always makes
 * progress.
 */
@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async pull(userId: string, query: SyncPullQuery): Promise<SyncPullResponse> {
    const run = query.cursor
      ? decodeCursor(query.cursor)
      : // Captured before reading, so anything written during this run is picked up by
        // the next one rather than falling into the gap between them.
        { startedAt: new Date(), matches: null, sessions: null, players: null, venues: null };

    const since = query.since ?? null;
    const take = query.limit;

    const [matches, sessions, players, venues] = await Promise.all([
      this.prisma.match.findMany({
        where: { userId, ...windowFor(run.matches, since) },
        include: MATCH_RECORD_INCLUDE,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
      this.prisma.session.findMany({
        where: { userId, ...windowFor(run.sessions, since) },
        include: { venue: { select: { id: true, name: true, city: true } } },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
      this.prisma.player.findMany({
        where: { userId, ...windowFor(run.players, since) },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
      this.prisma.venue.findMany({
        where: { userId, ...windowFor(run.venues, since) },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    ]);

    const [matchCount, sessionCount, playerCount, venueCount] = await Promise.all([
      this.prisma.match.count({ where: { userId } }),
      this.prisma.session.count({ where: { userId } }),
      this.prisma.player.count({ where: { userId } }),
      this.prisma.venue.count({ where: { userId } }),
    ]);

    const pages = { matches, sessions, players, venues };

    // A collection that filled its page has more to give. One that did not is finished
    // for this run, but its cursor still advances to the last row it returned — otherwise
    // the next page would re-run the `since` window and hand back the same rows again.
    const next: RunCursor = { startedAt: run.startedAt, ...emptyPositions() };
    let hasMore = false;

    for (const collection of COLLECTIONS) {
      const rows: Array<{ id: string; updatedAt: Date }> = pages[collection];
      const last = rows.at(-1);
      next[collection] = last ? { updatedAt: last.updatedAt, id: last.id } : run[collection];
      if (rows.length === take) hasMore = true;
    }

    const playerNames = new Map(players.map((player) => [player.id, player.name]));

    return {
      syncedAt: run.startedAt.toISOString(),
      hasMore,
      cursor: hasMore ? encodeCursor(next) : null,
      changed: {
        matches: matches.map((match) => this.toSyncMatch(match, playerNames)),
        sessions: sessions.map((session) => ({
          id: session.id,
          date: session.date.toISOString().slice(0, 10),
          sessionType: session.sessionType,
          startedAt: session.startedAt?.toISOString() ?? null,
          endedAt: session.endedAt?.toISOString() ?? null,
          notes: session.notes,
          venue: session.venue,
          updatedAt: session.updatedAt.toISOString(),
        })),
        players: players.map((player) => ({
          id: player.id,
          name: player.name,
          nickname: player.nickname,
          relationship: player.relationship,
          isSelf: player.isSelf,
          rating: player.rating,
          updatedAt: player.updatedAt.toISOString(),
        })),
        venues: venues.map((venue) => ({
          id: venue.id,
          name: venue.name,
          city: venue.city,
          isFavourite: venue.isFavourite,
          updatedAt: venue.updatedAt.toISOString(),
        })),
      },
      // Deletions are not tracked with tombstones. The client reconciles instead: when
      // its local count exceeds the authoritative count below, it re-pulls from scratch.
      // Tombstone tables are the more precise answer and the right one at a scale this
      // product does not have; the counts make the divergence detectable, which is what
      // actually matters.
      deleted: { matchIds: [], sessionIds: [], playerIds: [], venueIds: [] },
      counts: {
        matches: matchCount,
        sessions: sessionCount,
        players: playerCount,
        venues: venueCount,
      },
    };
  }

  private toSyncMatch(match: MatchWithRelations, playerNames: Map<string, string>): SyncMatch {
    const record = toMatchRecord(match);

    return {
      id: match.id,
      sessionId: match.sessionId,
      playedAt: match.playedAt.toISOString(),
      orderInSession: match.orderInSession,
      discipline: match.discipline,
      scoring: record.scoring,
      durationSeconds: match.durationSeconds,
      difficulty: match.difficulty,
      energyLevel: match.energyLevel,
      confidence: match.confidence,
      feeling: match.feeling,
      notes: match.notes,
      tags: match.tags.map((tag) => tag.tag),
      venue: match.session.venue
        ? { id: match.session.venue.id, name: match.session.venue.name }
        : null,
      partnerIds: record.partnerIds,
      opponentIds: record.opponentIds,
      // Names travel with the match so the offline cache can render a match card without
      // needing the player table to have synced first. A name is null only when that
      // player fell outside this page; the client fills it in once the player arrives.
      partnerNames: record.partnerIds.map((id) => playerNames.get(id) ?? null),
      opponentNames: record.opponentIds.map((id) => playerNames.get(id) ?? null),
      games: match.games.map((game) => ({
        gameNumber: game.gameNumber,
        myScore: game.myScore,
        opponentScore: game.opponentScore,
      })),
      derived: deriveMatch(record),
      updatedAt: match.updatedAt.toISOString(),
    };
  }

  /**
   * Cheap consistency check, called on launch.
   *
   * The client compares these totals with its own. A mismatch means something was
   * deleted on another device, and it re-pulls from scratch.
   */
  async status(userId: string): Promise<SyncStatusResponse> {
    const [matches, sessions, players, venues, lastMatch] = await Promise.all([
      this.prisma.match.count({ where: { userId } }),
      this.prisma.session.count({ where: { userId } }),
      this.prisma.player.count({ where: { userId } }),
      this.prisma.venue.count({ where: { userId } }),
      this.prisma.match.findFirst({
        where: { userId },
        orderBy: { playedAt: 'desc' },
        select: { playedAt: true },
      }),
    ]);

    return {
      serverTime: new Date().toISOString(),
      totals: { matches, sessions, players, venues },
      lastMatchAt: lastMatch?.playedAt.toISOString() ?? null,
    };
  }
}

function emptyPositions(): Omit<RunCursor, 'startedAt'> {
  return { matches: null, sessions: null, players: null, venues: null };
}

/**
 * The rows a collection still owes the client.
 *
 * Mid-run the comparison is on the `(updatedAt, id)` pair and strict, so rows sharing a
 * timestamp are walked through one page at a time instead of repeating. At the start of a
 * run there is no position yet, so the inclusive `since` window applies instead.
 */
function windowFor(position: CollectionCursor | null, since: Date | null): UpdatedAtWindow {
  if (position) {
    return {
      OR: [
        { updatedAt: { gt: position.updatedAt } },
        { updatedAt: position.updatedAt, id: { gt: position.id } },
      ],
    };
  }

  return since ? { updatedAt: { gte: since } } : {};
}

/**
 * Cursors are base64url JSON rather than a signed token.
 *
 * Nothing in one is a secret — it is four timestamps and four ids the client already
 * holds — and every query it feeds is still scoped to the caller's own user id, so a
 * forged cursor can only make a client skip or repeat its *own* records. Encoding keeps
 * clients from parsing it and depending on the shape.
 */
function encodeCursor(cursor: RunCursor): string {
  const payload = {
    t: cursor.startedAt.toISOString(),
    m: serialisePosition(cursor.matches),
    s: serialisePosition(cursor.sessions),
    p: serialisePosition(cursor.players),
    v: serialisePosition(cursor.venues),
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): RunCursor {
  try {
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      t: string;
      m: string | null;
      s: string | null;
      p: string | null;
      v: string | null;
    };

    const startedAt = new Date(payload.t);
    if (Number.isNaN(startedAt.getTime())) throw new Error('Invalid run start.');

    return {
      startedAt,
      matches: parsePosition(payload.m),
      sessions: parsePosition(payload.s),
      players: parsePosition(payload.p),
      venues: parsePosition(payload.v),
    };
  } catch {
    // Recoverable by the client: drop the cursor and start a fresh run.
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      'INVALID_SYNC_CURSOR',
      'The sync cursor is not valid. Start a new sync without one.',
    );
  }
}

function serialisePosition(position: CollectionCursor | null): string | null {
  return position ? `${position.updatedAt.toISOString()}|${position.id}` : null;
}

function parsePosition(raw: string | null): CollectionCursor | null {
  if (!raw) return null;

  const separator = raw.indexOf('|');
  if (separator < 0) throw new Error('Malformed position.');

  const updatedAt = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (Number.isNaN(updatedAt.getTime()) || !id) throw new Error('Malformed position.');

  return { updatedAt, id };
}
