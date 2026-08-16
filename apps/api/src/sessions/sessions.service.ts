import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CreateSessionInput,
  ListSessionsQuery,
  Paginated,
  SessionStats,
  SessionSummary,
  UpdateSessionInput,
} from '@badminton/contracts';
import { aggregate } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError } from '../common/errors';
import { pageMeta, paginate } from '../common/pagination';
import { toMatchRecord, MATCH_RECORD_INCLUDE } from '../matches/match-record.loader';

const SESSION_INCLUDE = {
  venue: { select: { id: true, name: true, city: true } },
  matches: { include: MATCH_RECORD_INCLUDE, orderBy: { orderInSession: 'asc' } },
} satisfies Prisma.SessionInclude;

type SessionRow = Prisma.SessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListSessionsQuery): Promise<Paginated<SessionSummary>> {
    const where: Prisma.SessionWhereInput = { userId };

    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: startOfUtcDay(query.from) } : {}),
        ...(query.to ? { lte: startOfUtcDay(query.to) } : {}),
      };
    }
    if (query.venueId) where.venueId = query.venueId;
    if (query.sessionType) where.sessionType = query.sessionType;

    const { skip, take } = paginate(query);

    const orderBy: Prisma.SessionOrderByWithRelationInput =
      query.sort === 'OLDEST'
        ? { date: 'asc' }
        : query.sort === 'MOST_MATCHES'
          ? { matches: { _count: 'desc' } }
          : { date: 'desc' };

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.session.findMany({ where, include: SESSION_INCLUDE, orderBy, skip, take }),
      this.prisma.session.count({ where }),
    ]);

    return { items: rows.map(toSummary), meta: pageMeta(query, totalItems) };
  }

  async findOne(userId: string, id: string): Promise<SessionSummary> {
    const session = await this.prisma.session.findFirst({
      where: { id, userId },
      include: SESSION_INCLUDE,
    });
    if (!session) throw new NotFoundError('Session');
    return toSummary(session);
  }

  async create(userId: string, input: CreateSessionInput): Promise<SessionSummary> {
    if (input.venueId) await this.assertVenue(userId, input.venueId);

    const created = await this.prisma.session.create({
      data: {
        userId,
        date: startOfUtcDay(input.date),
        venueId: input.venueId ?? null,
        sessionType: input.sessionType,
        startedAt: input.startedAt ?? null,
        endedAt: input.endedAt ?? null,
        notes: input.notes ?? null,
      },
      include: SESSION_INCLUDE,
    });

    return toSummary(created);
  }

  async update(userId: string, id: string, input: UpdateSessionInput): Promise<SessionSummary> {
    const session = await this.prisma.session.findFirst({ where: { id, userId } });
    if (!session) throw new NotFoundError('Session');
    if (input.venueId) await this.assertVenue(userId, input.venueId);

    const updated = await this.prisma.session.update({
      where: { id },
      data: {
        ...(input.date ? { date: startOfUtcDay(input.date) } : {}),
        venueId: input.venueId === undefined ? undefined : input.venueId,
        sessionType: input.sessionType,
        startedAt: input.startedAt === undefined ? undefined : input.startedAt,
        endedAt: input.endedAt === undefined ? undefined : input.endedAt,
        notes: input.notes === undefined ? undefined : input.notes,
      },
      include: SESSION_INCLUDE,
    });

    return toSummary(updated);
  }

  /**
   * Deleting a session removes the matches it contains, which is the intended meaning
   * of "delete this session" — but it is destructive, so the caller is told how many
   * matches went with it.
   */
  async remove(userId: string, id: string): Promise<{ deletedMatches: number }> {
    const session = await this.prisma.session.findFirst({
      where: { id, userId },
      include: { _count: { select: { matches: true } } },
    });
    if (!session) throw new NotFoundError('Session');

    await this.prisma.session.delete({ where: { id } });
    return { deletedMatches: session._count.matches };
  }

  private async assertVenue(userId: string, venueId: string): Promise<void> {
    const venue = await this.prisma.venue.findFirst({
      where: { id: venueId, userId },
      select: { id: true },
    });
    if (!venue) throw new NotFoundError('Venue');
  }
}

function toSummary(session: SessionRow): SessionSummary {
  const records = session.matches.map(toMatchRecord);
  const stats = aggregate(records);

  // Prefer the wall-clock span the user recorded; fall back to summed match durations,
  // which is all that is available when someone only logs scores.
  const wallClockMinutes =
    session.startedAt && session.endedAt
      ? Math.max(0, Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 60_000))
      : null;
  const playedMinutes = stats.playingSeconds > 0 ? Math.round(stats.playingSeconds / 60) : null;

  const sessionStats: SessionStats = {
    matches: stats.matches,
    wins: stats.wins,
    losses: stats.losses,
    draws: stats.draws,
    winRate: stats.winRate,
    gamesWon: stats.gamesWon,
    gamesLost: stats.gamesLost,
    pointsScored: stats.pointsScored,
    pointsConceded: stats.pointsConceded,
    pointDifferential: stats.pointDifferential,
    durationMinutes: wallClockMinutes ?? playedMinutes,
    averageMatchMinutes:
      stats.averageMatchSeconds === null ? null : Math.round(stats.averageMatchSeconds / 60),
  };

  return {
    id: session.id,
    date: session.date.toISOString().slice(0, 10),
    sessionType: session.sessionType,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    notes: session.notes,
    venue: session.venue
      ? { id: session.venue.id, name: session.venue.name, city: session.venue.city }
      : null,
    stats: sessionStats,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
