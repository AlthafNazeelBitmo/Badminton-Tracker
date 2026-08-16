import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AnalyticsFilter, DateRange } from '@badminton/contracts';
import type { MatchRecord } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Loads matches in the normalised shape the analytics engine consumes.
 *
 * Every analytics endpoint funnels through here, which gives the platform one place
 * where the filter semantics live and one query shape to optimise. The include is fixed
 * and shallow — games, participants, tags and the session's venue — so the whole load
 * is a bounded number of queries regardless of how many matches come back. No N+1.
 */
export const MATCH_RECORD_INCLUDE = {
  games: { orderBy: { gameNumber: 'asc' } },
  participants: {
    select: { playerId: true, side: true, isSelf: true },
    // Without an explicit order PostgreSQL is free to return participants in any
    // order, so a doubles pair could render as "John & Priya" on one request and
    // "Priya & John" on the next. Alphabetical within each side is stable and reads
    // sensibly; the user's own row sorts first on the home side.
    orderBy: [{ isSelf: 'desc' }, { player: { name: 'asc' } }],
  },
  tags: { select: { tag: true }, orderBy: { tag: 'asc' } },
  session: {
    select: {
      id: true,
      date: true,
      sessionType: true,
      venueId: true,
      venue: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.MatchInclude;

export type MatchWithRelations = Prisma.MatchGetPayload<{ include: typeof MATCH_RECORD_INCLUDE }>;

@Injectable()
export class MatchRecordLoader {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves a preset or explicit range into concrete bounds.
   *
   * Ranges are computed in the user's time zone so "this month" means their month.
   * `ALL_TIME` returns nulls rather than a sentinel date, so the query simply omits the
   * date filter and the planner can use the plain index.
   */
  resolveRange(filter: AnalyticsFilter, now = new Date()): DateRange {
    if (filter.preset === 'CUSTOM') {
      return { from: filter.from ?? null, to: filter.to ?? now };
    }
    if (filter.preset === 'ALL_TIME') return { from: null, to: null };

    const zone = filter.timeZone;
    const today = zonedCivil(now, zone);

    switch (filter.preset) {
      case 'TODAY':
        return { from: civilStart(today, zone), to: now };
      case 'THIS_WEEK': {
        const monday = addDays(today, -(isoWeekday(today) - 1));
        return { from: civilStart(monday, zone), to: now };
      }
      case 'THIS_MONTH':
        return { from: civilStart({ ...today, day: 1 }, zone), to: now };
      case 'LAST_30_DAYS':
        return { from: civilStart(addDays(today, -29), zone), to: now };
      case 'LAST_90_DAYS':
        return { from: civilStart(addDays(today, -89), zone), to: now };
      case 'LAST_180_DAYS':
        return { from: civilStart(addDays(today, -179), zone), to: now };
      case 'THIS_YEAR':
        return { from: civilStart({ year: today.year, month: 1, day: 1 }, zone), to: now };
      case 'LAST_YEAR':
        return {
          from: civilStart({ year: today.year - 1, month: 1, day: 1 }, zone),
          to: civilStart({ year: today.year, month: 1, day: 1 }, zone),
        };
      default:
        return { from: null, to: null };
    }
  }

  /** The window immediately preceding the given one, for period-over-period deltas. */
  previousRange(range: DateRange): DateRange | null {
    if (!range.from || !range.to) return null;
    const span = range.to.getTime() - range.from.getTime();
    if (span <= 0) return null;
    return { from: new Date(range.from.getTime() - span), to: range.from };
  }

  buildWhere(userId: string, filter: AnalyticsFilter, range: DateRange): Prisma.MatchWhereInput {
    const where: Prisma.MatchWhereInput = { userId };

    if (range.from || range.to) {
      where.playedAt = {
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      };
    }

    if (filter.discipline) where.discipline = filter.discipline;
    if (filter.result) where.result = filter.result;
    if (filter.difficulty) where.difficulty = filter.difficulty;
    if (filter.tag) where.tags = { some: { tag: filter.tag } };

    if (filter.sessionType || filter.venueId) {
      where.session = {
        ...(filter.sessionType ? { sessionType: filter.sessionType } : {}),
        ...(filter.venueId ? { venueId: filter.venueId } : {}),
      };
    }

    // An opponent is a participant on the AWAY side; a partner is on HOME but is not
    // the user. Encoding it this way means one participants table answers both.
    if (filter.opponentId) {
      where.participants = { some: { playerId: filter.opponentId, side: 'AWAY' } };
    }
    if (filter.partnerId) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { participants: { some: { playerId: filter.partnerId, side: 'HOME', isSelf: false } } },
      ];
    }

    return where;
  }

  async load(userId: string, filter: AnalyticsFilter, now = new Date()): Promise<MatchRecord[]> {
    const range = this.resolveRange(filter, now);
    return this.loadWhere(this.buildWhere(userId, filter, range));
  }

  async loadWhere(where: Prisma.MatchWhereInput): Promise<MatchRecord[]> {
    const rows = await this.prisma.match.findMany({
      where,
      include: MATCH_RECORD_INCLUDE,
      orderBy: { playedAt: 'asc' },
    });
    return rows.map(toMatchRecord);
  }

  /** Display names for players and venues, used by records and insights. */
  async lookupNames(userId: string): Promise<{
    playerName: (id: string) => string;
    venueName: (id: string) => string;
  }> {
    const [players, venues] = await Promise.all([
      this.prisma.player.findMany({ where: { userId }, select: { id: true, name: true } }),
      this.prisma.venue.findMany({ where: { userId }, select: { id: true, name: true } }),
    ]);

    const playerMap = new Map(players.map((player) => [player.id, player.name]));
    const venueMap = new Map(venues.map((venue) => [venue.id, venue.name]));

    return {
      playerName: (id) => playerMap.get(id) ?? 'Unknown player',
      venueName: (id) => venueMap.get(id) ?? 'Unspecified venue',
    };
  }
}

export function toMatchRecord(match: MatchWithRelations): MatchRecord {
  return {
    id: match.id,
    sessionId: match.sessionId,
    playedAt: match.playedAt,
    orderInSession: match.orderInSession,
    discipline: match.discipline,
    sessionType: match.session.sessionType,
    venueId: match.session.venueId,
    venueName: match.session.venue?.name ?? null,
    scoring: {
      pointsToWin: match.pointsToWin,
      winBy: match.winBy,
      maxPoints: match.maxPoints,
      bestOf: match.bestOf,
    },
    durationSeconds: match.durationSeconds,
    difficulty: match.difficulty,
    tags: match.tags.map((tag) => tag.tag),
    partnerIds: match.participants
      .filter((participant) => participant.side === 'HOME' && !participant.isSelf)
      .map((participant) => participant.playerId),
    opponentIds: match.participants
      .filter((participant) => participant.side === 'AWAY')
      .map((participant) => participant.playerId),
    games: match.games.map((game) => ({
      myScore: game.myScore,
      opponentScore: game.opponentScore,
    })),
  };
}

// --- Local civil-date helpers ----------------------------------------------
// The analytics package owns bucketing; these few helpers exist so range resolution
// does not need to import a chart concern into a query concern.

interface Civil {
  year: number;
  month: number;
  day: number;
}

function zonedCivil(instant: Date, timeZone: string): Civil {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

function addDays(civil: Civil, days: number): Civil {
  const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day) + days * 86_400_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function isoWeekday(civil: Civil): number {
  const day = new Date(Date.UTC(civil.year, civil.month - 1, civil.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * The instant at which the given civil day begins in `timeZone`.
 *
 * Computed by taking the naive UTC midnight and correcting by the zone's offset at that
 * moment, which is accurate either side of a DST change because the offset is sampled
 * from the zone itself rather than assumed.
 */
function civilStart(civil: Civil, timeZone: string): Date {
  const naive = Date.UTC(civil.year, civil.month - 1, civil.day);
  const offset = zoneOffsetMs(new Date(naive), timeZone);
  return new Date(naive - offset);
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(instant);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    pick('year'),
    pick('month') - 1,
    pick('day'),
    pick('hour'),
    pick('minute'),
    pick('second'),
  );
  return asUtc - instant.getTime();
}
