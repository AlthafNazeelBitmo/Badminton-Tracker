import type { PerformanceStats, StreakInfo } from '@badminton/contracts';
import type { MatchRecord, SeriesResult } from './types';
import { deriveMatch, gameMargin, gameResult } from './derive';
import { AVERAGE_DECIMALS, mean, percentage, round, sum } from './math';

export const EMPTY_STATS: PerformanceStats = Object.freeze({
  matches: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  winRate: null,
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  gameWinRate: null,
  pointsScored: 0,
  pointsConceded: 0,
  pointWinRate: null,
  pointDifferential: 0,
  averagePointsScoredPerGame: null,
  averagePointsConcededPerGame: null,
  averageWinningMargin: null,
  averageLosingMargin: null,
  playingSeconds: 0,
  averageMatchSeconds: null,
});

/**
 * The one aggregation function in the platform.
 *
 * Every breakdown (opponent, partner, venue, discipline, month, session, tag) is this
 * function applied to a filtered slice of the same match records, which guarantees that
 * "win rate" means exactly the same thing everywhere.
 *
 * Formulas — see docs/analytics.md:
 *   winRate      = wins / matches * 100
 *   gameWinRate  = gamesWon / gamesPlayed * 100
 *   pointWinRate = pointsScored / (pointsScored + pointsConceded) * 100
 *   pointDiff    = pointsScored - pointsConceded
 */
export function aggregate(matches: readonly MatchRecord[]): PerformanceStats {
  if (matches.length === 0) return { ...EMPTY_STATS };

  let wins = 0;
  let losses = 0;
  let draws = 0;
  let gamesWon = 0;
  let gamesLost = 0;
  let gamesPlayed = 0;
  let pointsScored = 0;
  let pointsConceded = 0;
  let playingSeconds = 0;
  let timedMatches = 0;

  const winningMargins: number[] = [];
  const losingMargins: number[] = [];

  for (const match of matches) {
    const derived = deriveMatch(match);

    if (derived.result === 'WIN') wins += 1;
    else if (derived.result === 'LOSS') losses += 1;
    else draws += 1;

    gamesWon += derived.gamesWon;
    gamesLost += derived.gamesLost;
    gamesPlayed += match.games.length;
    pointsScored += derived.pointsScored;
    pointsConceded += derived.pointsConceded;

    if (match.durationSeconds != null && match.durationSeconds > 0) {
      playingSeconds += match.durationSeconds;
      timedMatches += 1;
    }

    // Margins are measured per game so that a 2-0 and a 2-1 win are comparable.
    for (const game of match.games) {
      const outcome = gameResult(game);
      if (outcome === 'WIN') winningMargins.push(gameMargin(game));
      else if (outcome === 'LOSS') losingMargins.push(gameMargin(game));
    }
  }

  const totalPoints = pointsScored + pointsConceded;

  return {
    matches: matches.length,
    wins,
    losses,
    draws,
    winRate: percentage(wins, matches.length),
    gamesPlayed,
    gamesWon,
    gamesLost,
    gameWinRate: percentage(gamesWon, gamesPlayed),
    pointsScored,
    pointsConceded,
    pointWinRate: percentage(pointsScored, totalPoints),
    pointDifferential: pointsScored - pointsConceded,
    averagePointsScoredPerGame:
      gamesPlayed === 0 ? null : round(pointsScored / gamesPlayed, AVERAGE_DECIMALS),
    averagePointsConcededPerGame:
      gamesPlayed === 0 ? null : round(pointsConceded / gamesPlayed, AVERAGE_DECIMALS),
    averageWinningMargin: mean(winningMargins),
    averageLosingMargin: mean(losingMargins),
    playingSeconds,
    averageMatchSeconds: timedMatches === 0 ? null : round(playingSeconds / timedMatches, 0),
  };
}

export const EMPTY_STREAKS: StreakInfo = Object.freeze({
  currentWinStreak: 0,
  currentLossStreak: 0,
  bestWinStreak: 0,
  worstLossStreak: 0,
  current: 0,
  lastResultAt: null,
});

/**
 * Streaks over a chronological list of matches.
 *
 * Draws break a streak without starting one. `current` is signed so a single field can
 * drive the UI: +5 is a five-match winning run, -2 a two-match losing run.
 */
export function computeStreaks(matches: readonly MatchRecord[]): StreakInfo {
  if (matches.length === 0) return { ...EMPTY_STREAKS };

  const ordered = [...matches].sort(byPlayedAtAscending);
  const results: SeriesResult[] = ordered.map((match) => deriveMatch(match).result);

  let bestWinStreak = 0;
  let worstLossStreak = 0;
  let runningWins = 0;
  let runningLosses = 0;

  for (const result of results) {
    if (result === 'WIN') {
      runningWins += 1;
      runningLosses = 0;
    } else if (result === 'LOSS') {
      runningLosses += 1;
      runningWins = 0;
    } else {
      runningWins = 0;
      runningLosses = 0;
    }
    bestWinStreak = Math.max(bestWinStreak, runningWins);
    worstLossStreak = Math.max(worstLossStreak, runningLosses);
  }

  const lastMatch = ordered[ordered.length - 1];

  return {
    currentWinStreak: runningWins,
    currentLossStreak: runningLosses,
    bestWinStreak,
    worstLossStreak,
    current: runningWins > 0 ? runningWins : -runningLosses,
    lastResultAt: lastMatch ? lastMatch.playedAt.toISOString() : null,
  };
}

export function byPlayedAtAscending(a: MatchRecord, b: MatchRecord): number {
  const delta = a.playedAt.getTime() - b.playedAt.getTime();
  if (delta !== 0) return delta;
  // Within a session, fall back to the recorded order so streaks are deterministic.
  if (a.sessionId === b.sessionId) return a.orderInSession - b.orderInSession;
  return a.id.localeCompare(b.id);
}

/** Total points played, used for point-share calculations. */
export function totalPoints(matches: readonly MatchRecord[]): number {
  return sum(
    matches.flatMap((match) => match.games.map((game) => game.myScore + game.opponentScore)),
  );
}
