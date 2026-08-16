import { Injectable } from '@nestjs/common';
import type {
  AnalyticsFilter,
  DisciplineBreakdown,
  FatigueResponse,
  HeatmapResponse,
  Insight,
  OpponentBreakdown,
  OverviewResponse,
  PartnerBreakdown,
  PerformanceStats,
  PeriodGranularity,
  PersonalRecord,
  SearchResult,
  SituationalResponse,
  TagCorrelation,
  TrendResponse,
  VenueBreakdown,
} from '@badminton/contracts';
import { DISCIPLINES } from '@badminton/contracts';
import {
  aggregate,
  breakdownByDifficulty,
  breakdownByDiscipline,
  breakdownByPartner,
  breakdownByVenue,
  buildBreakdown,
  buildHeatmap,
  buildTrend,
  computeStreaks,
  fatigueAnalysis,
  generateInsights,
  groupMatches,
  isValidTimeZone,
  personalRecords,
  rollingWinRate,
  situationalAnalysis,
  tagCorrelations,
  type MatchRecord,
} from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { MatchRecordLoader } from '../matches/match-record.loader';
import { RatingService } from './rating.service';
import { ValidationError } from '../common/errors';

/**
 * Turns the pure analytics engine into API responses.
 *
 * This layer does three things and nothing else: load the right matches, call the
 * engine, and attach display names. It contains no formulas — every number comes from
 * `@badminton/analytics`, which is where the tests are. That separation is what stops
 * the "average margin" on the dashboard from drifting away from the one in the report.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: MatchRecordLoader,
    private readonly ratings: RatingService,
  ) {}

  /** Rejects a bogus IANA zone rather than silently bucketing into the wrong days. */
  private assertTimeZone(filter: AnalyticsFilter): void {
    if (!isValidTimeZone(filter.timeZone)) {
      throw new ValidationError('Unknown time zone.', [
        { path: 'timeZone', message: `"${filter.timeZone}" is not a recognised IANA time zone.` },
      ]);
    }
  }

  async overview(userId: string, filter: AnalyticsFilter): Promise<OverviewResponse> {
    this.assertTimeZone(filter);

    const now = new Date();
    const range = this.loader.resolveRange(filter, now);
    const matches = await this.loader.loadWhere(this.loader.buildWhere(userId, filter, range));

    const previousRange = this.loader.previousRange(range);
    const previousMatches = previousRange
      ? await this.loader.loadWhere(this.loader.buildWhere(userId, filter, previousRange))
      : [];

    const opponents = new Set(matches.flatMap((match) => match.opponentIds));
    const partners = new Set(matches.flatMap((match) => match.partnerIds));
    const venues = new Set(
      matches.map((match) => match.venueId).filter((id): id is string => id !== null),
    );

    const ordered = [...matches].sort(
      (a, b) => a.playedAt.getTime() - b.playedAt.getTime(),
    );

    return {
      stats: aggregate(matches),
      streaks: computeStreaks(matches),
      sessions: new Set(matches.map((match) => match.sessionId)).size,
      distinctOpponents: opponents.size,
      distinctPartners: partners.size,
      distinctVenues: venues.size,
      firstMatchAt: ordered[0]?.playedAt.toISOString() ?? null,
      lastMatchAt: ordered[ordered.length - 1]?.playedAt.toISOString() ?? null,
      previousPeriod: previousRange ? aggregate(previousMatches) : null,
      rating: await this.ratings.summary(userId),
    };
  }

  async trend(
    userId: string,
    filter: AnalyticsFilter,
    granularity: PeriodGranularity,
  ): Promise<TrendResponse> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    return buildTrend(matches, granularity, filter.timeZone);
  }

  async form(
    userId: string,
    filter: AnalyticsFilter,
    window = 10,
  ): Promise<Array<{ playedAt: string; winRate: number }>> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    return rollingWinRate(matches, window);
  }

  async opponents(userId: string, filter: AnalyticsFilter): Promise<OpponentBreakdown[]> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    const groups = groupMatches(matches, (match) => match.opponentIds);
    const players = await this.playerSubjects(userId, [...groups.keys()]);

    return [...groups.entries()]
      .map(([playerId, group]) =>
        buildBreakdown(
          players.get(playerId) ?? unknownPlayer(playerId),
          group,
        ),
      )
      .sort(byMatchesThenWinRate);
  }

  async partners(userId: string, filter: AnalyticsFilter): Promise<PartnerBreakdown[]> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    const groups = breakdownByPartner(matches);
    const players = await this.playerSubjects(userId, [...groups.keys()]);

    return [...groups.entries()]
      .map(([playerId, group]) =>
        buildBreakdown(players.get(playerId) ?? unknownPlayer(playerId), group),
      )
      .sort(byMatchesThenWinRate);
  }

  async venues(userId: string, filter: AnalyticsFilter): Promise<VenueBreakdown[]> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    const groups = breakdownByVenue(matches);

    const venueIds = [...groups.keys()].filter((id) => id !== '');
    const rows = await this.prisma.venue.findMany({
      where: { userId, id: { in: venueIds } },
      select: { id: true, name: true, city: true },
    });
    const venueMap = new Map(rows.map((venue) => [venue.id, venue]));

    return [...groups.entries()]
      .map(([venueId, group]) => {
        const venue = venueId === '' ? null : venueMap.get(venueId);
        const base = buildBreakdown(
          {
            id: venue?.id ?? null,
            name: venue?.name ?? 'Unspecified venue',
            city: venue?.city ?? null,
          },
          group,
        );
        return {
          ...base,
          singles: aggregate(group.filter((match) => match.discipline === 'SINGLES')),
          doubles: aggregate(group.filter((match) => match.discipline !== 'SINGLES')),
        };
      })
      .sort((a, b) => b.stats.matches - a.stats.matches);
  }

  async disciplines(userId: string, filter: AnalyticsFilter): Promise<DisciplineBreakdown[]> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    const groups = breakdownByDiscipline(matches);

    // Every discipline is returned, including ones with no matches, so the comparison
    // view has a stable set of columns rather than shifting as data arrives.
    return DISCIPLINES.map((discipline) =>
      buildBreakdown({ discipline }, groups.get(discipline) ?? []),
    );
  }

  async situational(userId: string, filter: AnalyticsFilter): Promise<SituationalResponse> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    return situationalAnalysis(matches);
  }

  async fatigue(userId: string, filter: AnalyticsFilter): Promise<FatigueResponse> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    return fatigueAnalysis(matches);
  }

  async tags(userId: string, filter: AnalyticsFilter): Promise<TagCorrelation[]> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    return tagCorrelations(matches);
  }

  async difficulty(
    userId: string,
    filter: AnalyticsFilter,
  ): Promise<Array<{ difficulty: number; stats: PerformanceStats }>> {
    this.assertTimeZone(filter);
    const matches = await this.loader.load(userId, filter);
    return breakdownByDifficulty(matches);
  }

  async heatmap(userId: string, filter: AnalyticsFilter): Promise<HeatmapResponse> {
    this.assertTimeZone(filter);
    const now = new Date();
    const range = this.loader.resolveRange(filter, now);
    const matches = await this.loader.loadWhere(this.loader.buildWhere(userId, filter, range));

    const from =
      range.from ??
      matches[0]?.playedAt ??
      new Date(now.getTime() - 365 * 86_400_000);

    return buildHeatmap(matches, from, range.to ?? now, filter.timeZone);
  }

  async records(userId: string, filter: AnalyticsFilter): Promise<PersonalRecord[]> {
    this.assertTimeZone(filter);
    const [matches, names] = await Promise.all([
      this.loader.load(userId, filter),
      this.loader.lookupNames(userId),
    ]);
    return personalRecords(matches, { timeZone: filter.timeZone, playerName: names.playerName });
  }

  async insights(userId: string, filter: AnalyticsFilter): Promise<Insight[]> {
    this.assertTimeZone(filter);
    const [matches, names] = await Promise.all([
      this.loader.load(userId, filter),
      this.loader.lookupNames(userId),
    ]);
    return generateInsights(matches, {
      timeZone: filter.timeZone,
      now: new Date(),
      playerName: names.playerName,
      venueName: names.venueName,
    });
  }

  /**
   * Global search across players, venues, sessions and matches.
   *
   * Each entity is capped at five hits: this backs a command-palette style box where
   * breadth beats depth, and the caller can drill into a filtered list from there.
   */
  async search(userId: string, term: string): Promise<SearchResult> {
    const query = term.trim();
    if (query.length < 2) {
      return { players: [], venues: [], sessions: [], matches: [] };
    }

    const contains = { contains: query, mode: 'insensitive' as const };

    const [players, venues, sessions, matches] = await Promise.all([
      this.prisma.player.findMany({
        where: { userId, isSelf: false, OR: [{ name: contains }, { nickname: contains }] },
        take: 5,
        select: { id: true, name: true, relationship: true, _count: { select: { participants: true } } },
      }),
      this.prisma.venue.findMany({
        where: { userId, OR: [{ name: contains }, { city: contains }] },
        take: 5,
        select: { id: true, name: true, city: true, _count: { select: { sessions: true } } },
      }),
      this.prisma.session.findMany({
        where: { userId, OR: [{ notes: contains }, { venue: { name: contains } }] },
        take: 5,
        orderBy: { date: 'desc' },
        select: {
          id: true,
          date: true,
          sessionType: true,
          venue: { select: { name: true } },
          _count: { select: { matches: true } },
        },
      }),
      this.prisma.match.findMany({
        where: {
          userId,
          OR: [
            { notes: contains },
            { participants: { some: { player: { name: contains } } } },
          ],
        },
        take: 5,
        orderBy: { playedAt: 'desc' },
        select: {
          id: true,
          playedAt: true,
          discipline: true,
          result: true,
          participants: {
            where: { side: 'AWAY' },
            select: { player: { select: { name: true } } },
          },
        },
      }),
    ]);

    return {
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
        subtitle: `${player._count.participants} match${player._count.participants === 1 ? '' : 'es'}`,
      })),
      venues: venues.map((venue) => ({
        id: venue.id,
        name: venue.name,
        subtitle: [venue.city, `${venue._count.sessions} session${venue._count.sessions === 1 ? '' : 's'}`]
          .filter(Boolean)
          .join(' · '),
      })),
      sessions: sessions.map((session) => ({
        id: session.id,
        date: session.date.toISOString().slice(0, 10),
        subtitle: [session.venue?.name, `${session._count.matches} matches`]
          .filter(Boolean)
          .join(' · '),
      })),
      matches: matches.map((match) => ({
        id: match.id,
        playedAt: match.playedAt.toISOString(),
        subtitle: `${match.result} vs ${
          match.participants.map((participant) => participant.player.name).join(' & ') || 'unknown'
        }`,
      })),
    };
  }

  private async playerSubjects(
    userId: string,
    ids: string[],
  ): Promise<Map<string, { id: string; name: string; nickname: string | null; avatarUrl: string | null; rating: number }>> {
    if (ids.length === 0) return new Map();

    const rows = await this.prisma.player.findMany({
      where: { userId, id: { in: ids } },
      select: { id: true, name: true, nickname: true, avatarUrl: true, rating: true },
    });

    return new Map(rows.map((row) => [row.id, row]));
  }
}

function unknownPlayer(id: string) {
  return { id, name: 'Unknown player', nickname: null, avatarUrl: null, rating: 1200 };
}

/** Most-played first; ties broken by win rate so the ordering is deterministic. */
function byMatchesThenWinRate(
  a: { stats: PerformanceStats },
  b: { stats: PerformanceStats },
): number {
  if (b.stats.matches !== a.stats.matches) return b.stats.matches - a.stats.matches;
  return (b.stats.winRate ?? -1) - (a.stats.winRate ?? -1);
}

export type { MatchRecord };
