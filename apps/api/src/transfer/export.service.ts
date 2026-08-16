import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CSV_TEMPLATE, type ExportQuery } from '@badminton/contracts';
import { aggregate, formatScoreline } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { MatchRecordLoader, MATCH_RECORD_INCLUDE } from '../matches/match-record.loader';
import { AuditService } from '../auth/audit.service';
import { toCsv } from './csv';

export interface ExportResult {
  filename: string;
  contentType: string;
  body: string;
}

/**
 * Data export.
 *
 * The exported CSV uses exactly the columns the importer accepts, so a round trip
 * through a spreadsheet works: export, edit, re-import. That is also the honest answer
 * to "can I get my data out" — a file that only this product can read is not portable.
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: MatchRecordLoader,
    private readonly audit: AuditService,
  ) {}

  template(): ExportResult {
    return {
      filename: 'badminton-import-template.csv',
      contentType: 'text/csv; charset=utf-8',
      body: CSV_TEMPLATE,
    };
  }

  async export(userId: string, query: ExportQuery): Promise<ExportResult> {
    await this.audit.record('data.export', {
      userId,
      metadata: { dataset: query.dataset, format: query.format },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const base = `badminton-${query.dataset}-${stamp}`;

    const data = await this.collect(userId, query);

    if (query.format === 'json') {
      return {
        filename: `${base}.json`,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(data.json, null, 2),
      };
    }

    return {
      filename: `${base}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: toCsv(data.headers, data.rows),
    };
  }

  private async collect(
    userId: string,
    query: ExportQuery,
  ): Promise<{ headers: string[]; rows: unknown[][]; json: unknown }> {
    const dateFilter: Prisma.DateTimeFilter | undefined =
      query.from || query.to
        ? { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) }
        : undefined;

    switch (query.dataset) {
      case 'matches': {
        const rows = await this.prisma.match.findMany({
          where: { userId, ...(dateFilter ? { playedAt: dateFilter } : {}) },
          include: MATCH_RECORD_INCLUDE,
          orderBy: { playedAt: 'asc' },
        });

        const withNames = await this.attachNames(userId, rows);

        return {
          headers: [
            'date',
            'venue',
            'sessionType',
            'discipline',
            'partner',
            'opponent1',
            'opponent2',
            'game1',
            'game2',
            'game3',
            'game4',
            'game5',
            'durationMinutes',
            'difficulty',
            'notes',
            'result',
            'pointDifferential',
          ],
          rows: withNames.map((row) => [
            row.match.playedAt.toISOString().slice(0, 10),
            row.match.session.venue?.name ?? '',
            row.match.session.sessionType,
            row.match.discipline,
            row.partners[0] ?? '',
            row.opponents[0] ?? '',
            row.opponents[1] ?? '',
            ...gameCells(row.match.games),
            row.match.durationSeconds === null ? '' : Math.round(row.match.durationSeconds / 60),
            row.match.difficulty ?? '',
            row.match.notes ?? '',
            row.match.result,
            row.match.pointDifferential,
          ]),
          json: withNames.map((row) => ({
            id: row.match.id,
            playedAt: row.match.playedAt.toISOString(),
            discipline: row.match.discipline,
            sessionType: row.match.session.sessionType,
            venue: row.match.session.venue?.name ?? null,
            partners: row.partners,
            opponents: row.opponents,
            scoring: {
              pointsToWin: row.match.pointsToWin,
              winBy: row.match.winBy,
              maxPoints: row.match.maxPoints,
              bestOf: row.match.bestOf,
            },
            games: row.match.games.map((game) => ({
              gameNumber: game.gameNumber,
              myScore: game.myScore,
              opponentScore: game.opponentScore,
            })),
            result: row.match.result,
            pointDifferential: row.match.pointDifferential,
            durationSeconds: row.match.durationSeconds,
            difficulty: row.match.difficulty,
            tags: row.match.tags.map((tag) => tag.tag),
            notes: row.match.notes,
          })),
        };
      }

      case 'sessions': {
        const sessions = await this.prisma.session.findMany({
          where: { userId, ...(dateFilter ? { date: dateFilter } : {}) },
          include: { venue: true, matches: { include: MATCH_RECORD_INCLUDE } },
          orderBy: { date: 'asc' },
        });

        const json = sessions.map((session) => {
          const stats = aggregate(
            session.matches.map((match) => ({
              id: match.id,
              sessionId: match.sessionId,
              playedAt: match.playedAt,
              orderInSession: match.orderInSession,
              discipline: match.discipline,
              sessionType: session.sessionType,
              venueId: session.venueId,
              venueName: session.venue?.name ?? null,
              scoring: {
                pointsToWin: match.pointsToWin,
                winBy: match.winBy,
                maxPoints: match.maxPoints,
                bestOf: match.bestOf,
              },
              durationSeconds: match.durationSeconds,
              difficulty: match.difficulty,
              tags: match.tags.map((tag) => tag.tag),
              partnerIds: [],
              opponentIds: [],
              games: match.games.map((game) => ({
                myScore: game.myScore,
                opponentScore: game.opponentScore,
              })),
            })),
          );

          return {
            id: session.id,
            date: session.date.toISOString().slice(0, 10),
            sessionType: session.sessionType,
            venue: session.venue?.name ?? null,
            notes: session.notes,
            matches: stats.matches,
            wins: stats.wins,
            losses: stats.losses,
            winRate: stats.winRate,
            pointDifferential: stats.pointDifferential,
          };
        });

        return {
          headers: ['date', 'sessionType', 'venue', 'matches', 'wins', 'losses', 'winRate', 'pointDifferential', 'notes'],
          rows: json.map((session) => [
            session.date,
            session.sessionType,
            session.venue ?? '',
            session.matches,
            session.wins,
            session.losses,
            session.winRate ?? '',
            session.pointDifferential,
            session.notes ?? '',
          ]),
          json,
        };
      }

      case 'players': {
        const players = await this.prisma.player.findMany({
          where: { userId },
          include: { _count: { select: { participants: true } } },
          orderBy: { name: 'asc' },
        });

        const json = players.map((player) => ({
          id: player.id,
          name: player.name,
          nickname: player.nickname,
          relationship: player.relationship,
          playingLevel: player.playingLevel,
          dominantHand: player.dominantHand,
          playingStyle: player.playingStyle,
          rating: player.rating,
          matchesPlayed: player._count.participants,
          notes: player.notes,
        }));

        return {
          headers: ['name', 'nickname', 'relationship', 'playingLevel', 'dominantHand', 'playingStyle', 'rating', 'matchesPlayed', 'notes'],
          rows: json.map((player) => [
            player.name,
            player.nickname ?? '',
            player.relationship,
            player.playingLevel ?? '',
            player.dominantHand,
            player.playingStyle,
            player.rating,
            player.matchesPlayed,
            player.notes ?? '',
          ]),
          json,
        };
      }

      case 'venues': {
        const venues = await this.prisma.venue.findMany({
          where: { userId },
          include: { _count: { select: { sessions: true } } },
          orderBy: { name: 'asc' },
        });

        const json = venues.map((venue) => ({
          id: venue.id,
          name: venue.name,
          location: venue.location,
          city: venue.city,
          country: venue.country,
          isIndoor: venue.isIndoor,
          courtCount: venue.courtCount,
          sessions: venue._count.sessions,
        }));

        return {
          headers: ['name', 'location', 'city', 'country', 'isIndoor', 'courtCount', 'sessions'],
          rows: json.map((venue) => [
            venue.name,
            venue.location ?? '',
            venue.city ?? '',
            venue.country ?? '',
            venue.isIndoor,
            venue.courtCount ?? '',
            venue.sessions,
          ]),
          json,
        };
      }

      case 'statistics': {
        const matches = await this.loader.loadWhere({
          userId,
          ...(dateFilter ? { playedAt: dateFilter } : {}),
        });
        const stats = aggregate(matches);

        const entries = Object.entries(stats);
        return {
          headers: ['metric', 'value'],
          rows: entries.map(([metric, value]) => [metric, value ?? '']),
          json: stats,
        };
      }
    }
  }

  private async attachNames(
    userId: string,
    matches: Prisma.MatchGetPayload<{ include: typeof MATCH_RECORD_INCLUDE }>[],
  ) {
    const playerIds = new Set(
      matches.flatMap((match) => match.participants.map((participant) => participant.playerId)),
    );
    const players = await this.prisma.player.findMany({
      where: { userId, id: { in: [...playerIds] } },
      select: { id: true, name: true },
    });
    const names = new Map(players.map((player) => [player.id, player.name]));

    return matches.map((match) => ({
      match,
      partners: match.participants
        .filter((participant) => participant.side === 'HOME' && !participant.isSelf)
        .map((participant) => names.get(participant.playerId) ?? 'Unknown'),
      opponents: match.participants
        .filter((participant) => participant.side === 'AWAY')
        .map((participant) => names.get(participant.playerId) ?? 'Unknown'),
    }));
  }
}

/** Five game columns, blank-padded, matching the import template exactly. */
function gameCells(games: Array<{ myScore: number; opponentScore: number }>): string[] {
  const cells = games.map((game) => `${game.myScore}-${game.opponentScore}`);
  while (cells.length < 5) cells.push('');
  return cells.slice(0, 5);
}

export { formatScoreline };
