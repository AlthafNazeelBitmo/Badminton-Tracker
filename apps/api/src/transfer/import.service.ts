import { Injectable } from '@nestjs/common';
import {
  CSV_IMPORT_COLUMNS,
  CSV_REQUIRED_COLUMNS,
  DEFAULT_SCORING_RULES,
  DISCIPLINES,
  SESSION_TYPES,
  parseGameCell,
  validateMatchGames,
  type Discipline,
  type ImportCommitInput,
  type ImportCommitResponse,
  type ImportIssue,
  type ImportPreviewInput,
  type ImportPreviewResponse,
  type ImportPreviewRow,
  type ScoreLine,
  type ScoringRules,
  type SessionType,
} from '@badminton/contracts';
import { deriveMatch } from '@badminton/analytics';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationError } from '../common/errors';
import { normalizeName, tidyDisplayName } from '../common/normalize';
import { PlayersService } from '../players/players.service';
import { VenuesService } from '../venues/venues.service';
import { RatingService } from '../analytics/rating.service';
import { AchievementsService } from '../progress/achievements.service';
import { AuditService } from '../auth/audit.service';
import { parseCsvRecords } from './csv';

const MAX_ROWS = 10_000;
const GAME_COLUMNS = ['game1', 'game2', 'game3', 'game4', 'game5'] as const;

/**
 * CSV import.
 *
 * The contract with the user is that nothing is written until they have seen exactly
 * what will happen. `preview` parses and validates every row and reports what it found;
 * `commit` re-parses the same text and writes only the rows the user accepted. A row
 * that cannot be understood is reported with its row number and reason — never guessed
 * at, never partially imported, never silently dropped.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly players: PlayersService,
    private readonly venues: VenuesService,
    private readonly ratings: RatingService,
    private readonly achievements: AchievementsService,
    private readonly audit: AuditService,
  ) {}

  async preview(userId: string, input: ImportPreviewInput): Promise<ImportPreviewResponse> {
    const { rows, issues } = await this.analyse(userId, input);

    return {
      totalRows: rows.length,
      readyRows: rows.filter((row) => row.status === 'READY').length,
      invalidRows: rows.filter((row) => row.status === 'INVALID').length,
      duplicateRows: rows.filter((row) => row.status === 'DUPLICATE').length,
      rows,
      issues,
    };
  }

  async commit(userId: string, input: ImportCommitInput): Promise<ImportCommitResponse> {
    const { rows, issues } = await this.analyse(userId, input);

    const accepted = new Set(input.acceptRows);
    const importable = rows.filter((row) => row.status === 'READY' && accepted.has(row.rowNumber));

    const scoring = await this.defaultScoring(userId);

    let importedMatches = 0;
    const createdSessions = new Set<string>();
    let createdPlayers = 0;
    let createdVenues = 0;

    // One transaction for the whole import: a partial import is worse than none, because
    // the user cannot tell which half landed.
    await this.prisma.$transaction(
      async (tx) => {
        const self = await this.players.self(userId);

        for (const row of importable) {
          if (!row.date || !row.discipline) continue;

          const date = new Date(`${row.date}T00:00:00.000Z`);

          let venueId: string | null = null;
          if (row.venueName) {
            const venue = await this.venues.resolveByName(tx, userId, row.venueName);
            venueId = venue.id;
            if (venue.created) createdVenues += 1;
          }

          const sessionType = row.sessionType ?? 'CASUAL';
          let session = await tx.session.findFirst({
            where: { userId, date, venueId, sessionType },
            select: { id: true },
          });
          if (!session) {
            session = await tx.session.create({
              data: { userId, date, venueId, sessionType },
              select: { id: true },
            });
            createdSessions.add(session.id);
          }

          const partners = await this.players.resolveRefs(
            tx,
            userId,
            row.partnerNames.map((name) => ({ name })),
          );
          const opponents = await this.players.resolveRefs(
            tx,
            userId,
            row.opponentNames.map((name) => ({ name })),
          );
          createdPlayers += partners.created.length + opponents.created.length;

          const last = await tx.match.findFirst({
            where: { sessionId: session.id },
            orderBy: { orderInSession: 'desc' },
            select: { orderInSession: true },
          });
          const orderInSession = (last?.orderInSession ?? 0) + 1;

          const derived = deriveMatch({ games: row.games, scoring });

          await tx.match.create({
            data: {
              userId,
              sessionId: session.id,
              // Imported rows carry a date but no clock time; matches are spaced an hour
              // apart from 18:00 so their order within the session is stable and sortable.
              playedAt: new Date(date.getTime() + (18 + orderInSession - 1) * 3600 * 1000),
              orderInSession,
              discipline: row.discipline,
              durationSeconds: row.durationMinutes === null ? null : row.durationMinutes * 60,
              pointsToWin: scoring.pointsToWin,
              winBy: scoring.winBy,
              maxPoints: scoring.maxPoints,
              bestOf: scoring.bestOf,
              difficulty: row.difficulty,
              notes: row.notes,
              result: derived.result,
              gamesWon: derived.gamesWon,
              gamesLost: derived.gamesLost,
              pointsScored: derived.pointsScored,
              pointsConceded: derived.pointsConceded,
              pointDifferential: derived.pointDifferential,
              games: {
                create: row.games.map((game, index) => ({
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
            },
          });

          importedMatches += 1;
        }
      },
      { timeout: 120_000 },
    );

    await this.ratings.recalculate(userId);
    await this.achievements.evaluate(userId);
    await this.audit.record('data.import', {
      userId,
      metadata: { importedMatches, rowsSubmitted: rows.length },
    });

    return {
      importedMatches,
      createdSessions: createdSessions.size,
      createdPlayers,
      createdVenues,
      skippedRows: rows.length - importedMatches,
      issues,
    };
  }

  // -------------------------------------------------------------------------

  /** Parses and validates every row, marking each READY, INVALID or DUPLICATE. */
  private async analyse(
    userId: string,
    input: ImportPreviewInput,
  ): Promise<{ rows: ImportPreviewRow[]; issues: ImportIssue[] }> {
    const { headers, records } = parseCsvRecords(input.csv, CSV_IMPORT_COLUMNS);
    const fileIssues: ImportIssue[] = [];

    if (headers.length === 0) {
      throw new ValidationError('The file appears to be empty.');
    }

    const missing = CSV_REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
    if (missing.length > 0) {
      throw new ValidationError(
        `The file is missing required column(s): ${missing.join(', ')}.`,
        missing.map((column) => ({ path: column, message: `Column "${column}" is required.` })),
      );
    }

    if (records.length > MAX_ROWS) {
      throw new ValidationError(`Imports are limited to ${MAX_ROWS} rows per file.`);
    }

    const scoring = await this.defaultScoring(userId);
    const existingKeys = input.skipDuplicates
      ? await this.existingMatchKeys(userId)
      : new Set<string>();

    const rows: ImportPreviewRow[] = [];
    const seenInFile = new Set<string>();

    for (const [index, record] of records.entries()) {
      // +2 because row 1 is the header and spreadsheets are 1-indexed, so the number
      // shown matches what the user sees in their editor.
      const rowNumber = index + 2;
      const issues: ImportIssue[] = [];
      const add = (column: string | null, code: string, message: string) =>
        issues.push({ rowNumber, column, code, message });

      const date = parseDate(record.date ?? '');
      if (!date)
        add('date', 'INVALID_DATE', `"${record.date ?? ''}" is not a valid date (use YYYY-MM-DD).`);

      const discipline = parseEnum(record.discipline ?? '', DISCIPLINES);
      if (!discipline) {
        add(
          'discipline',
          'INVALID_DISCIPLINE',
          `Discipline must be one of ${DISCIPLINES.join(', ')}.`,
        );
      }

      const sessionType = record.sessionType
        ? parseEnum(record.sessionType, SESSION_TYPES)
        : 'CASUAL';
      if (record.sessionType && !sessionType) {
        add(
          'sessionType',
          'INVALID_SESSION_TYPE',
          `Session type must be one of ${SESSION_TYPES.join(', ')}.`,
        );
      }

      const opponentNames = [record.opponent1, record.opponent2]
        .map((name) => (name ?? '').trim())
        .filter(Boolean)
        .map(tidyDisplayName);
      const partnerNames = [(record.partner ?? '').trim()].filter(Boolean).map(tidyDisplayName);

      if (opponentNames.length === 0) {
        add('opponent1', 'MISSING_OPPONENT', 'At least one opponent is required.');
      }

      if (discipline) {
        const expectedOpponents = discipline === 'SINGLES' ? 1 : 2;
        const expectedPartners = discipline === 'SINGLES' ? 0 : 1;
        if (opponentNames.length !== expectedOpponents) {
          add(
            'opponent2',
            'OPPONENT_COUNT',
            `${discipline} needs exactly ${expectedOpponents} opponent(s); found ${opponentNames.length}.`,
          );
        }
        if (partnerNames.length !== expectedPartners) {
          add(
            'partner',
            'PARTNER_COUNT',
            `${discipline} needs exactly ${expectedPartners} partner(s); found ${partnerNames.length}.`,
          );
        }
      }

      const games: ScoreLine[] = [];
      for (const column of GAME_COLUMNS) {
        const cell = record[column];
        if (!cell) continue;
        const parsed = parseGameCell(cell);
        if (!parsed) {
          add(column, 'INVALID_SCORE', `"${cell}" is not a score (expected e.g. 21-18).`);
          continue;
        }
        games.push(parsed);
      }

      if (games.length === 0) {
        add('game1', 'MISSING_GAMES', 'At least one game score is required.');
      } else {
        const check = validateMatchGames(games, scoring);
        for (const issue of check.issues) {
          add(
            issue.gameIndex === undefined ? null : (GAME_COLUMNS[issue.gameIndex] ?? null),
            issue.code,
            issue.message,
          );
        }
      }

      const allNames = [...partnerNames, ...opponentNames];
      if (new Set(allNames.map(normalizeName)).size !== allNames.length) {
        add(null, 'DUPLICATE_PLAYER', 'The same person appears more than once in this match.');
      }

      const durationMinutes = parseOptionalNumber(record.durationMinutes, 0, 720);
      if (record.durationMinutes && durationMinutes === null) {
        add(
          'durationMinutes',
          'INVALID_DURATION',
          'Duration must be a whole number of minutes between 0 and 720.',
        );
      }

      const difficulty = parseOptionalNumber(record.difficulty, 1, 5);
      if (record.difficulty && difficulty === null) {
        add('difficulty', 'INVALID_DIFFICULTY', 'Difficulty must be a whole number from 1 to 5.');
      }

      const notes = (record.notes ?? '').trim().slice(0, 4000) || null;

      const derived = games.length > 0 ? deriveMatch({ games, scoring }) : null;
      const key = date && discipline ? matchKey(date, opponentNames, games) : null;

      let status: ImportPreviewRow['status'] = issues.length > 0 ? 'INVALID' : 'READY';
      if (status === 'READY' && key) {
        if (existingKeys.has(key)) {
          status = 'DUPLICATE';
          add(null, 'DUPLICATE_MATCH', 'A matching match is already recorded on this date.');
        } else if (seenInFile.has(key)) {
          status = 'DUPLICATE';
          add(null, 'DUPLICATE_IN_FILE', 'This row duplicates an earlier row in the same file.');
        } else {
          seenInFile.add(key);
        }
      }

      rows.push({
        rowNumber,
        status,
        date: date ? date.toISOString().slice(0, 10) : null,
        discipline: discipline ?? null,
        sessionType: (sessionType as SessionType | null) ?? null,
        venueName: (record.venue ?? '').trim() ? tidyDisplayName(record.venue!) : null,
        partnerNames,
        opponentNames,
        games,
        durationMinutes,
        difficulty,
        notes,
        result: derived?.result ?? null,
        issues,
        newPlayers: [],
        newVenue: null,
      });
    }

    await this.markNewEntities(userId, rows);

    return { rows, issues: fileIssues };
  }

  /** Flags which players and venues an import would create, so the preview can say so. */
  private async markNewEntities(userId: string, rows: ImportPreviewRow[]): Promise<void> {
    const names = new Set<string>();
    const venues = new Set<string>();

    for (const row of rows) {
      [...row.partnerNames, ...row.opponentNames].forEach((name) => names.add(normalizeName(name)));
      if (row.venueName) venues.add(normalizeName(row.venueName));
    }

    const [existingPlayers, existingVenues] = await Promise.all([
      names.size === 0
        ? []
        : this.prisma.player.findMany({
            where: { userId, normalizedName: { in: [...names] } },
            select: { normalizedName: true },
          }),
      venues.size === 0
        ? []
        : this.prisma.venue.findMany({
            where: { userId, normalizedName: { in: [...venues] } },
            select: { normalizedName: true },
          }),
    ]);

    const knownPlayers = new Set(existingPlayers.map((player) => player.normalizedName));
    const knownVenues = new Set(existingVenues.map((venue) => venue.normalizedName));

    for (const row of rows) {
      row.newPlayers = [...row.partnerNames, ...row.opponentNames].filter(
        (name) => !knownPlayers.has(normalizeName(name)),
      );
      row.newVenue =
        row.venueName && !knownVenues.has(normalizeName(row.venueName)) ? row.venueName : null;
    }
  }

  /**
   * Keys of matches already stored, for duplicate detection.
   *
   * A match is considered the same when it happened on the same calendar day against the
   * same opponents with the same scoreline. That is specific enough not to reject two
   * genuinely different matches, and loose enough to catch a re-uploaded file.
   */
  private async existingMatchKeys(userId: string): Promise<Set<string>> {
    const matches = await this.prisma.match.findMany({
      where: { userId },
      select: {
        playedAt: true,
        games: { select: { myScore: true, opponentScore: true }, orderBy: { gameNumber: 'asc' } },
        participants: {
          where: { side: 'AWAY' },
          select: { player: { select: { name: true } } },
        },
      },
    });

    return new Set(
      matches.map((match) =>
        matchKey(
          match.playedAt,
          match.participants.map((participant) => participant.player.name),
          match.games,
        ),
      ),
    );
  }

  private async defaultScoring(userId: string): Promise<ScoringRules> {
    const profile = await this.prisma.playerProfile.findUnique({ where: { userId } });
    if (!profile) return { ...DEFAULT_SCORING_RULES };
    return {
      pointsToWin: profile.defaultPointsToWin,
      winBy: profile.defaultWinBy,
      maxPoints: profile.defaultMaxPoints,
      bestOf: profile.defaultBestOf,
    };
  }
}

function matchKey(date: Date, opponents: string[], games: ScoreLine[]): string {
  const day = date.toISOString().slice(0, 10);
  const names = opponents.map(normalizeName).sort().join('|');
  const scores = games.map((game) => `${game.myScore}-${game.opponentScore}`).join(',');
  return `${day}::${names}::${scores}`;
}

/** Accepts `YYYY-MM-DD`, `DD/MM/YYYY` and `MM/DD/YYYY` where unambiguous. */
function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[2]);
    const year = Number(slashed[3]);
    // Only accept a slashed date when one component cannot be a month, so an ambiguous
    // 05/06/2026 is rejected rather than silently read as the wrong day.
    if (first > 12 && second <= 12) {
      return new Date(Date.UTC(year, second - 1, first));
    }
    if (second > 12 && first <= 12) {
      return new Date(Date.UTC(year, first - 1, second));
    }
    return null;
  }

  return null;
}

function parseEnum<T extends readonly string[]>(value: string, allowed: T): T[number] | null {
  const normalised = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return (allowed as readonly string[]).includes(normalised) ? (normalised as T[number]) : null;
}

/** Parses an optional whole-number cell, returning null when blank or out of range. */
function parseOptionalNumber(value: string | undefined, min: number, max: number): number | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

export type { Discipline };
