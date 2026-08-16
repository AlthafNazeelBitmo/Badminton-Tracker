import type { PersonalRecord } from '@badminton/contracts';
import { ANALYTICS_CONSTANTS, type MatchRecord } from './types';
import { aggregate, byPlayedAtAscending, computeStreaks } from './aggregate';
import { deriveMatch, formatScoreline, gameMargin, gameResult } from './derive';
import { breakdownByPartner, breakdownBySession, groupMatches } from './breakdowns';
import { bucketKey } from './time';
import { percentage } from './math';

export interface RecordContext {
  timeZone: string;
  /** Resolves a player id to a display name for record descriptions. */
  playerName: (playerId: string) => string;
}

/**
 * Personal records, recomputed from raw matches on every request.
 *
 * They are never stored, so they cannot go stale: editing or deleting a match
 * immediately and correctly changes the records it used to hold.
 */
export function personalRecords(
  matches: readonly MatchRecord[],
  context: RecordContext,
): PersonalRecord[] {
  const ordered = [...matches].sort(byPlayedAtAscending);
  if (ordered.length === 0) return [];

  const records: PersonalRecord[] = [];
  const push = (record: PersonalRecord) => records.push(record);

  // --- Streaks -------------------------------------------------------------
  const streaks = computeStreaks(ordered);
  push({
    code: 'BEST_WIN_STREAK',
    label: 'Most consecutive wins',
    value: `${streaks.bestWinStreak}`,
    detail: streaks.bestWinStreak > 0 ? `${streaks.bestWinStreak} matches in a row` : null,
    matchId: null,
    sessionId: null,
    occurredAt: null,
  });

  // --- Highest scoring game -----------------------------------------------
  let highestGame: { match: MatchRecord; total: number; score: string } | null = null;
  let largestWin: { match: MatchRecord; margin: number; score: string } | null = null;
  let closestWin: { match: MatchRecord; margin: number; score: string } | null = null;
  let longestMatch: MatchRecord | null = null;
  let biggestComeback: { match: MatchRecord; deficit: number } | null = null;

  for (const match of ordered) {
    const derived = deriveMatch(match);

    for (const game of match.games) {
      const total = game.myScore + game.opponentScore;
      const score = `${game.myScore}-${game.opponentScore}`;
      if (!highestGame || total > highestGame.total) highestGame = { match, total, score };

      if (gameResult(game) === 'WIN') {
        const margin = gameMargin(game);
        if (!largestWin || margin > largestWin.margin) largestWin = { match, margin, score };
        if (!closestWin || margin < closestWin.margin) closestWin = { match, margin, score };
      }
    }

    if (
      match.durationSeconds != null &&
      (longestMatch === null || match.durationSeconds > (longestMatch.durationSeconds ?? 0))
    ) {
      longestMatch = match;
    }

    if (derived.isComeback) {
      const firstGame = match.games[0];
      const deficit = firstGame ? gameMargin(firstGame) : 0;
      if (!biggestComeback || deficit > biggestComeback.deficit) {
        biggestComeback = { match, deficit };
      }
    }
  }

  if (highestGame) {
    push({
      code: 'HIGHEST_SCORING_GAME',
      label: 'Highest scoring game',
      value: highestGame.score,
      detail: `${highestGame.total} total points`,
      matchId: highestGame.match.id,
      sessionId: highestGame.match.sessionId,
      occurredAt: highestGame.match.playedAt.toISOString(),
    });
  }
  if (largestWin) {
    push({
      code: 'LARGEST_WINNING_MARGIN',
      label: 'Largest winning margin',
      value: largestWin.score,
      detail: `Won by ${largestWin.margin} points`,
      matchId: largestWin.match.id,
      sessionId: largestWin.match.sessionId,
      occurredAt: largestWin.match.playedAt.toISOString(),
    });
  }
  if (closestWin) {
    push({
      code: 'CLOSEST_WIN',
      label: 'Closest win',
      value: closestWin.score,
      detail: `Won by ${closestWin.margin} point${closestWin.margin === 1 ? '' : 's'}`,
      matchId: closestWin.match.id,
      sessionId: closestWin.match.sessionId,
      occurredAt: closestWin.match.playedAt.toISOString(),
    });
  }
  if (longestMatch?.durationSeconds) {
    push({
      code: 'LONGEST_MATCH',
      label: 'Longest match',
      value: `${Math.round(longestMatch.durationSeconds / 60)} min`,
      detail: formatScoreline(longestMatch.games),
      matchId: longestMatch.id,
      sessionId: longestMatch.sessionId,
      occurredAt: longestMatch.playedAt.toISOString(),
    });
  }
  if (biggestComeback) {
    push({
      code: 'BIGGEST_COMEBACK',
      label: 'Biggest comeback',
      value: formatScoreline(biggestComeback.match.games),
      detail: `Lost the first game by ${biggestComeback.deficit} and won the match`,
      matchId: biggestComeback.match.id,
      sessionId: biggestComeback.match.sessionId,
      occurredAt: biggestComeback.match.playedAt.toISOString(),
    });
  }

  // --- Monthly volume and win rate ----------------------------------------
  const months = groupMatches(ordered, (match) => [
    bucketKey(match.playedAt, 'MONTH', context.timeZone).key,
  ]);

  let mostMatchesMonth: { key: string; count: number } | null = null;
  let bestMonthRate: { key: string; rate: number; matches: number } | null = null;

  for (const [key, group] of months) {
    if (!mostMatchesMonth || group.length > mostMatchesMonth.count) {
      mostMatchesMonth = { key, count: group.length };
    }
    const stats = aggregate(group);
    // Require a meaningful sample so a single 1-0 month cannot claim "best month".
    if (
      stats.winRate !== null &&
      group.length >= ANALYTICS_CONSTANTS.minMatchesForInsight &&
      (!bestMonthRate || stats.winRate > bestMonthRate.rate)
    ) {
      bestMonthRate = { key, rate: stats.winRate, matches: group.length };
    }
  }

  if (mostMatchesMonth) {
    push({
      code: 'MOST_MATCHES_IN_MONTH',
      label: 'Most matches in a month',
      value: `${mostMatchesMonth.count}`,
      detail: mostMatchesMonth.key,
      matchId: null,
      sessionId: null,
      occurredAt: null,
    });
  }
  if (bestMonthRate) {
    push({
      code: 'BEST_MONTHLY_WIN_RATE',
      label: 'Best monthly win rate',
      value: `${bestMonthRate.rate}%`,
      detail: `${bestMonthRate.key} (${bestMonthRate.matches} matches)`,
      matchId: null,
      sessionId: null,
      occurredAt: null,
    });
  }

  // --- Sessions ------------------------------------------------------------
  const sessions = breakdownBySession(ordered);
  let biggestSession: { id: string; count: number; at: string } | null = null;
  for (const [sessionId, group] of sessions) {
    const first = group[0];
    if (!first) continue;
    if (!biggestSession || group.length > biggestSession.count) {
      biggestSession = { id: sessionId, count: group.length, at: first.playedAt.toISOString() };
    }
  }
  if (biggestSession) {
    push({
      code: 'MOST_MATCHES_IN_SESSION',
      label: 'Most matches in one session',
      value: `${biggestSession.count}`,
      detail: null,
      matchId: null,
      sessionId: biggestSession.id,
      occurredAt: biggestSession.at,
    });
  }

  // --- Head-to-head and partnerships --------------------------------------
  const opponentGroups = groupMatches(ordered, (match) => match.opponentIds);
  let mostWinsOpponent: { id: string; wins: number; matches: number } | null = null;
  for (const [playerId, group] of opponentGroups) {
    const stats = aggregate(group);
    if (!mostWinsOpponent || stats.wins > mostWinsOpponent.wins) {
      mostWinsOpponent = { id: playerId, wins: stats.wins, matches: stats.matches };
    }
  }
  if (mostWinsOpponent && mostWinsOpponent.wins > 0) {
    push({
      code: 'MOST_WINS_VS_OPPONENT',
      label: 'Most wins against one opponent',
      value: `${mostWinsOpponent.wins}`,
      detail: `${context.playerName(mostWinsOpponent.id)} (${mostWinsOpponent.matches} matches)`,
      matchId: null,
      sessionId: null,
      occurredAt: null,
    });
  }

  const partnerGroups = breakdownByPartner(ordered);
  let bestPartner: { id: string; rate: number; matches: number } | null = null;
  for (const [playerId, group] of partnerGroups) {
    if (group.length < ANALYTICS_CONSTANTS.minMatchesForInsight) continue;
    const stats = aggregate(group);
    if (stats.winRate === null) continue;
    if (!bestPartner || stats.winRate > bestPartner.rate) {
      bestPartner = { id: playerId, rate: stats.winRate, matches: group.length };
    }
  }
  if (bestPartner) {
    push({
      code: 'BEST_PARTNERSHIP',
      label: 'Best partner combination',
      value: `${bestPartner.rate}%`,
      detail: `${context.playerName(bestPartner.id)} (${bestPartner.matches} matches)`,
      matchId: null,
      sessionId: null,
      occurredAt: null,
    });
  }

  // --- Perfect sessions ----------------------------------------------------
  const perfect = countPerfectSessions(ordered);
  push({
    code: 'PERFECT_SESSIONS',
    label: 'Perfect sessions',
    value: `${perfect}`,
    detail: `Sessions of ${ANALYTICS_CONSTANTS.perfectSessionMinMatches}+ matches won outright`,
    matchId: null,
    sessionId: null,
    occurredAt: null,
  });

  return records;
}

/** A session counts as perfect when every match in it was won and it was long enough. */
export function countPerfectSessions(matches: readonly MatchRecord[]): number {
  let count = 0;
  for (const [, group] of breakdownBySession(matches)) {
    if (group.length < ANALYTICS_CONSTANTS.perfectSessionMinMatches) continue;
    const stats = aggregate(group);
    if (stats.wins === group.length) count += 1;
  }
  return count;
}

/** Aggregate counters used for achievement detection and goal progress. */
export function achievementCounters(matches: readonly MatchRecord[]): {
  matchesPlayed: number;
  matchesWon: number;
  gamesPlayed: number;
  gamesWon: number;
  pointsScored: number;
  sessionsPlayed: number;
  bestWinStreak: number;
  comebacks: number;
  perfectSessions: number;
  distinctOpponents: number;
  distinctVenues: number;
} {
  const stats = aggregate(matches);
  const streaks = computeStreaks(matches);

  const opponents = new Set<string>();
  const venues = new Set<string>();
  let comebacks = 0;

  for (const match of matches) {
    match.opponentIds.forEach((id) => opponents.add(id));
    if (match.venueId) venues.add(match.venueId);
    if (deriveMatch(match).isComeback) comebacks += 1;
  }

  return {
    matchesPlayed: stats.matches,
    matchesWon: stats.wins,
    gamesPlayed: stats.gamesPlayed,
    gamesWon: stats.gamesWon,
    pointsScored: stats.pointsScored,
    sessionsPlayed: new Set(matches.map((match) => match.sessionId)).size,
    bestWinStreak: streaks.bestWinStreak,
    comebacks,
    perfectSessions: countPerfectSessions(matches),
    distinctOpponents: opponents.size,
    distinctVenues: venues.size,
  };
}

/** Win rate helper reused by report generation. */
export function winRateOf(matches: readonly MatchRecord[]): number | null {
  const stats = aggregate(matches);
  return percentage(stats.wins, stats.matches);
}
