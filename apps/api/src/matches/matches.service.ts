import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_SCORING_RULES,
  PLAYERS_PER_SIDE,
  validateMatchGames,
  validateScoringRules,
  type CreateMatchInput,
  type ListMatchesQuery,
  type MatchDetail,
  type MatchSummary,
  type Paginated,
  type ScoringRules,
  type UpdateMatchInput,
} from '@badminton/contracts';
import { deriveMatch, formatScoreline } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundError, ValidationError } from '../common/errors';
import { pageMeta, paginate } from '../common/pagination';
import { PlayersService } from '../players/players.service';
import { VenuesService } from '../venues/venues.service';
import {
  MATCH_RECORD_INCLUDE,
  toMatchRecord,
  type MatchWithRelations,
} from './match-record.loader';
import { RatingService } from '../analytics/rating.service';
import { AchievementsService } from '../progress/achievements.service';

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly players: PlayersService,
    private readonly venues: VenuesService,
    private readonly ratings: RatingService,
    private readonly achievements: AchievementsService,
  ) {}

  // -------------------------------------------------------------------------
  // Write path
  // -------------------------------------------------------------------------

  /**
   * Records a match.
   *
   * The whole operation is one transaction: session resolution, player creation,
   * participants, games and the derived columns either all land or none do. A
   * half-written match would corrupt every statistic derived from it.
   */
  async create(userId: string, input: CreateMatchInput): Promise<MatchDetail> {
    const scoring = await this.resolveScoring(userId, input.scoring);
    this.assertValidMatch(input.games, scoring);

    const matchId = await this.prisma.$transaction(async (tx) => {
      const sessionId = await this.resolveSession(tx, userId, input);

      // Resolved one side at a time, not concurrently: both calls may create a player,
      // and interleaving them on the same transaction races on the unique name
      // constraint. Sequential resolution also means a name appearing on both sides is
      // found the second time and caught by the overlap check below, rather than
      // surfacing as a confusing duplicate-key conflict.
      const partners = await this.players.resolveRefs(tx, userId, input.partners);
      const opponents = await this.players.resolveRefs(tx, userId, input.opponents);

      const overlap = partners.playerIds.filter((id) => opponents.playerIds.includes(id));
      if (overlap.length > 0) {
        throw new ValidationError('A player cannot be on both sides of the same match.');
      }

      const self = await this.players.self(userId);
      const session = await tx.session.findFirstOrThrow({
        where: { id: sessionId, userId },
        select: { id: true, date: true },
      });

      const playedAt = input.playedAt ?? defaultPlayedAt(session.date);
      const orderInSession = await nextOrderInSession(tx, sessionId);
      const derived = deriveMatch({ games: input.games, scoring });

      const created = await tx.match.create({
        data: {
          userId,
          sessionId,
          playedAt,
          orderInSession,
          discipline: input.discipline,
          durationSeconds: input.durationSeconds ?? null,
          pointsToWin: scoring.pointsToWin,
          winBy: scoring.winBy,
          maxPoints: scoring.maxPoints,
          bestOf: scoring.bestOf,
          difficulty: input.difficulty ?? null,
          energyLevel: input.energyLevel ?? null,
          confidence: input.confidence ?? null,
          feeling: input.feeling ?? null,
          notes: input.notes ?? null,
          result: derived.result,
          gamesWon: derived.gamesWon,
          gamesLost: derived.gamesLost,
          pointsScored: derived.pointsScored,
          pointsConceded: derived.pointsConceded,
          pointDifferential: derived.pointDifferential,
          games: {
            create: input.games.map((game, index) => ({
              gameNumber: index + 1,
              myScore: game.myScore,
              opponentScore: game.opponentScore,
            })),
          },
          participants: {
            create: [
              { playerId: self.id, side: 'HOME', isSelf: true },
              ...partners.playerIds.map((playerId) => ({
                playerId,
                side: 'HOME' as const,
                isSelf: false,
              })),
              ...opponents.playerIds.map((playerId) => ({
                playerId,
                side: 'AWAY' as const,
                isSelf: false,
              })),
            ],
          },
          tags: { create: input.tags.map((tag) => ({ tag })) },
        },
        select: { id: true },
      });

      return created.id;
    });

    // Ratings and achievements are projections of match data. They are refreshed after
    // the match is committed so a failure here can never roll back a recorded result —
    // and both are fully rebuildable from matches if one is ever missed.
    await this.ratings.recalculate(userId);
    await this.achievements.evaluate(userId);

    return this.findOne(userId, matchId);
  }

  async update(userId: string, id: string, input: UpdateMatchInput): Promise<MatchDetail> {
    const existing = await this.prisma.match.findFirst({
      where: { id, userId },
      select: { id: true, sessionId: true },
    });
    if (!existing) throw new NotFoundError('Match');

    const scoring = await this.resolveScoring(userId, input.scoring);
    this.assertValidMatch(input.games, scoring);

    await this.prisma.$transaction(async (tx) => {
      const partners = await this.players.resolveRefs(tx, userId, input.partners);
      const opponents = await this.players.resolveRefs(tx, userId, input.opponents);

      const overlap = partners.playerIds.filter((playerId) =>
        opponents.playerIds.includes(playerId),
      );
      if (overlap.length > 0) {
        throw new ValidationError('A player cannot be on both sides of the same match.');
      }

      const self = await this.players.self(userId);
      const derived = deriveMatch({ games: input.games, scoring });

      let sessionId = existing.sessionId;
      if (input.sessionId && input.sessionId !== existing.sessionId) {
        const target = await tx.session.findFirst({
          where: { id: input.sessionId, userId },
          select: { id: true },
        });
        if (!target) throw new NotFoundError('Session');
        sessionId = target.id;
      }

      // Games and participants are replaced wholesale rather than diffed: a match has a
      // handful of each, and a full replace has no partial-update failure modes.
      await tx.game.deleteMany({ where: { matchId: id } });
      await tx.matchParticipant.deleteMany({ where: { matchId: id } });
      await tx.matchTag.deleteMany({ where: { matchId: id } });

      await tx.match.update({
        where: { id },
        data: {
          sessionId,
          ...(input.playedAt ? { playedAt: input.playedAt } : {}),
          discipline: input.discipline,
          durationSeconds: input.durationSeconds ?? null,
          pointsToWin: scoring.pointsToWin,
          winBy: scoring.winBy,
          maxPoints: scoring.maxPoints,
          bestOf: scoring.bestOf,
          difficulty: input.difficulty ?? null,
          energyLevel: input.energyLevel ?? null,
          confidence: input.confidence ?? null,
          feeling: input.feeling ?? null,
          notes: input.notes ?? null,
          result: derived.result,
          gamesWon: derived.gamesWon,
          gamesLost: derived.gamesLost,
          pointsScored: derived.pointsScored,
          pointsConceded: derived.pointsConceded,
          pointDifferential: derived.pointDifferential,
          games: {
            create: input.games.map((game, index) => ({
              gameNumber: index + 1,
              myScore: game.myScore,
              opponentScore: game.opponentScore,
            })),
          },
          participants: {
            create: [
              { playerId: self.id, side: 'HOME', isSelf: true },
              ...partners.playerIds.map((playerId) => ({
                playerId,
                side: 'HOME' as const,
                isSelf: false,
              })),
              ...opponents.playerIds.map((playerId) => ({
                playerId,
                side: 'AWAY' as const,
                isSelf: false,
              })),
            ],
          },
          tags: { create: input.tags.map((tag) => ({ tag })) },
        },
      });
    });

    await this.ratings.recalculate(userId);
    await this.achievements.evaluate(userId);

    return this.findOne(userId, id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const match = await this.prisma.match.findFirst({
      where: { id, userId },
      select: { id: true, sessionId: true, orderInSession: true },
    });
    if (!match) throw new NotFoundError('Match');

    await this.prisma.$transaction(async (tx) => {
      await tx.match.delete({ where: { id } });

      // Close the gap so `orderInSession` stays a contiguous 1..n sequence; the fatigue
      // analysis reads it as "the nth match of the session" and a hole would skew it.
      const remaining = await tx.match.findMany({
        where: { sessionId: match.sessionId },
        orderBy: { orderInSession: 'asc' },
        select: { id: true, orderInSession: true },
      });

      await renumberSession(tx, remaining);
    });

    await this.ratings.recalculate(userId);
  }

  // -------------------------------------------------------------------------
  // Read path
  // -------------------------------------------------------------------------

  async list(userId: string, query: ListMatchesQuery): Promise<Paginated<MatchSummary>> {
    const where: Prisma.MatchWhereInput = { userId };

    if (query.from || query.to) {
      where.playedAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }
    if (query.discipline) where.discipline = query.discipline;
    if (query.result) where.result = query.result;
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.difficulty) where.difficulty = query.difficulty;
    if (query.tag) where.tags = { some: { tag: query.tag } };
    if (query.venueId) where.session = { venueId: query.venueId };
    if (query.opponentId) {
      where.participants = { some: { playerId: query.opponentId, side: 'AWAY' } };
    }
    if (query.partnerId) {
      where.AND = [
        { participants: { some: { playerId: query.partnerId, side: 'HOME', isSelf: false } } },
      ];
    }
    if (query.search) {
      // Searches notes, session notes and participant names in one pass.
      where.OR = [
        { notes: { contains: query.search, mode: 'insensitive' } },
        { session: { notes: { contains: query.search, mode: 'insensitive' } } },
        {
          participants: {
            some: { player: { name: { contains: query.search, mode: 'insensitive' } } },
          },
        },
      ];
    }

    const { skip, take } = paginate(query);

    const [rows, totalItems] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        include: MATCH_RECORD_INCLUDE,
        orderBy: orderForSort(query.sort),
        skip,
        take,
      }),
      this.prisma.match.count({ where }),
    ]);

    return {
      items: await this.decorate(userId, rows),
      meta: pageMeta(query, totalItems),
    };
  }

  async findOne(userId: string, id: string): Promise<MatchDetail> {
    const match = await this.prisma.match.findFirst({
      where: { id, userId },
      include: MATCH_RECORD_INCLUDE,
    });
    if (!match) throw new NotFoundError('Match');

    const [summary] = await this.decorate(userId, [match]);
    if (!summary) throw new NotFoundError('Match');

    const ratingEvent = await this.prisma.ratingEvent.findUnique({ where: { matchId: id } });

    return {
      ...summary,
      session: {
        id: match.session.id,
        date: match.session.date.toISOString().slice(0, 10),
        sessionType: match.session.sessionType,
      },
      insights: buildMatchInsights(match),
      ratingChange: ratingEvent
        ? {
            before: ratingEvent.ratingBefore,
            after: ratingEvent.ratingAfter,
            delta: ratingEvent.delta,
          }
        : null,
    };
  }

  /**
   * Attaches player names to a page of matches with a single extra query, rather than
   * one per match. The names are small and heavily reused, so fetching the user's whole
   * address book once beats joining it onto every row.
   */
  private async decorate(userId: string, rows: MatchWithRelations[]): Promise<MatchSummary[]> {
    if (rows.length === 0) return [];

    const playerIds = new Set(
      rows.flatMap((row) => row.participants.map((participant) => participant.playerId)),
    );
    const players = await this.prisma.player.findMany({
      where: { userId, id: { in: [...playerIds] } },
      select: { id: true, name: true, nickname: true, avatarUrl: true, isSelf: true },
    });
    const playerMap = new Map(players.map((player) => [player.id, player]));

    return rows.map((row) => {
      const record = toMatchRecord(row);
      const derived = deriveMatch(record);

      const view = (playerId: string, side: 'HOME' | 'AWAY') => {
        const player = playerMap.get(playerId);
        return {
          playerId,
          name: player?.name ?? 'Unknown player',
          nickname: player?.nickname ?? null,
          avatarUrl: player?.avatarUrl ?? null,
          side,
          isSelf: player?.isSelf ?? false,
        };
      };

      return {
        id: row.id,
        sessionId: row.sessionId,
        playedAt: row.playedAt.toISOString(),
        orderInSession: row.orderInSession,
        discipline: row.discipline,
        scoring: record.scoring,
        durationSeconds: row.durationSeconds,
        difficulty: row.difficulty,
        energyLevel: row.energyLevel,
        confidence: row.confidence,
        feeling: row.feeling,
        notes: row.notes,
        tags: row.tags.map((tag) => tag.tag),
        venue: row.session.venue
          ? { id: row.session.venue.id, name: row.session.venue.name }
          : null,
        partners: record.partnerIds.map((playerId) => view(playerId, 'HOME')),
        opponents: record.opponentIds.map((playerId) => view(playerId, 'AWAY')),
        games: row.games.map((game) => ({
          id: game.id,
          gameNumber: game.gameNumber,
          myScore: game.myScore,
          opponentScore: game.opponentScore,
          result:
            game.myScore > game.opponentScore
              ? ('WIN' as const)
              : game.myScore < game.opponentScore
                ? ('LOSS' as const)
                : ('DRAW' as const),
          margin: Math.abs(game.myScore - game.opponentScore),
        })),
        derived,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Falls back to the user's saved default format when the client sends none. */
  private async resolveScoring(
    userId: string,
    supplied: ScoringRules | undefined,
  ): Promise<ScoringRules> {
    if (supplied) {
      const check = validateScoringRules(supplied);
      if (!check.valid) {
        throw new ValidationError(
          'The scoring format is not valid.',
          check.issues.map((issue) => ({
            path: 'scoring',
            message: issue.message,
            code: issue.code,
          })),
        );
      }
      return supplied;
    }

    const profile = await this.prisma.playerProfile.findUnique({ where: { userId } });
    if (!profile) return { ...DEFAULT_SCORING_RULES };

    return {
      pointsToWin: profile.defaultPointsToWin,
      winBy: profile.defaultWinBy,
      maxPoints: profile.defaultMaxPoints,
      bestOf: profile.defaultBestOf,
    };
  }

  /**
   * Rejects impossible scorelines before anything is written.
   *
   * The rules are shared with the web client, so the form catches these first — but the
   * server is the authority, because a client check is a convenience and never a
   * guarantee.
   */
  private assertValidMatch(
    games: Array<{ myScore: number; opponentScore: number }>,
    scoring: ScoringRules,
  ): void {
    const result = validateMatchGames(games, scoring);
    if (result.valid) return;

    throw new ValidationError(
      'The scores are not valid for this format.',
      result.issues.map((issue) => ({
        path: issue.gameIndex === undefined ? 'games' : `games.${issue.gameIndex}`,
        message: issue.message,
        code: issue.code,
      })),
    );
  }

  /**
   * Finds or creates the session a quick-entry match belongs to.
   *
   * Reusing an existing session for the same day and venue is what lets someone record
   * five matches in a row without thinking about sessions at all.
   */
  private async resolveSession(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CreateMatchInput,
  ): Promise<string> {
    if (input.sessionId) {
      const session = await tx.session.findFirst({
        where: { id: input.sessionId, userId },
        select: { id: true },
      });
      if (!session) throw new NotFoundError('Session');
      return session.id;
    }

    const draft = input.session;
    if (!draft) throw new ValidationError('A session or session id is required.');

    let venueId = draft.venueId ?? null;
    if (!venueId && draft.venueName) {
      venueId = (await this.venues.resolveByName(tx, userId, draft.venueName)).id;
    }
    if (venueId) {
      const venue = await tx.venue.findFirst({
        where: { id: venueId, userId },
        select: { id: true },
      });
      if (!venue) throw new NotFoundError('Venue');
    }

    const date = startOfUtcDay(draft.date);

    const existing = await tx.session.findFirst({
      where: { userId, date, venueId, sessionType: draft.sessionType },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await tx.session.create({
      data: { userId, date, venueId, sessionType: draft.sessionType },
      select: { id: true },
    });
    return created.id;
  }
}

function orderForSort(sort: ListMatchesQuery['sort']): Prisma.MatchOrderByWithRelationInput[] {
  switch (sort) {
    case 'OLDEST':
      return [{ playedAt: 'asc' }, { orderInSession: 'asc' }];
    case 'BIGGEST_WIN':
      return [{ pointDifferential: 'desc' }, { playedAt: 'desc' }];
    case 'CLOSEST':
      // Closest matches sit near a zero differential; ascending puts the heaviest
      // defeats first, so the UI labels this "narrowest margin" and sorts by absolute
      // value in the client for the handful of rows on screen.
      return [{ pointDifferential: 'asc' }, { playedAt: 'desc' }];
    case 'LONGEST':
      return [{ durationSeconds: 'desc' }, { playedAt: 'desc' }];
    case 'HIGHEST_SCORING':
      return [{ pointsScored: 'desc' }, { playedAt: 'desc' }];
    case 'NEWEST':
    default:
      return [{ playedAt: 'desc' }, { orderInSession: 'desc' }];
  }
}

async function nextOrderInSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<number> {
  const last = await tx.match.findFirst({
    where: { sessionId },
    orderBy: { orderInSession: 'desc' },
    select: { orderInSession: true },
  });
  return (last?.orderInSession ?? 0) + 1;
}

/**
 * Renumbers a session's matches to 1..n.
 *
 * `orderInSession` is unique per session, so shifting values down would collide with
 * rows that have not moved yet. Everything is parked in a negative range first, which
 * cannot collide with any real value, then written back in order.
 */
async function renumberSession(
  tx: Prisma.TransactionClient,
  matches: Array<{ id: string; orderInSession: number }>,
): Promise<void> {
  const needsRenumber = matches.some((match, index) => match.orderInSession !== index + 1);
  if (!needsRenumber) return;

  for (const [index, match] of matches.entries()) {
    await tx.match.update({ where: { id: match.id }, data: { orderInSession: -(index + 1) } });
  }
  for (const [index, match] of matches.entries()) {
    await tx.match.update({ where: { id: match.id }, data: { orderInSession: index + 1 } });
  }
}

/** Sessions store a bare date; a match with no explicit time defaults to 18:00 local-naive. */
function defaultPlayedAt(sessionDate: Date): Date {
  return new Date(sessionDate.getTime() + 18 * 3600 * 1000);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Per-match observations shown on the detail page. Facts only, drawn from this match. */
function buildMatchInsights(match: MatchWithRelations): string[] {
  const record = toMatchRecord(match);
  const derived = deriveMatch(record);
  const insights: string[] = [];

  if (derived.isComeback) {
    insights.push('You lost the first game and came back to win the match.');
  }
  if (derived.isCollapse) {
    insights.push('You won the first game but lost the match.');
  }
  if (derived.wentToDecider) {
    insights.push(`This match went the distance, decided in game ${match.games.length}.`);
  }
  if (derived.isClutch) {
    insights.push('Every game was decided by three points or fewer.');
  }
  if (derived.isBlowout) {
    insights.push('Every game was decided by eleven points or more.');
  }

  const longest = match.games.reduce<{ number: number; total: number } | null>((best, game) => {
    const total = game.myScore + game.opponentScore;
    return !best || total > best.total ? { number: game.gameNumber, total } : best;
  }, null);
  if (longest && match.games.length > 1) {
    insights.push(`Game ${longest.number} was the longest, at ${longest.total} points played.`);
  }

  insights.push(
    `Final scoreline ${formatScoreline(record.games)} for a point differential of ${
      derived.pointDifferential >= 0 ? '+' : ''
    }${derived.pointDifferential}.`,
  );

  return insights;
}

export { PLAYERS_PER_SIDE };
