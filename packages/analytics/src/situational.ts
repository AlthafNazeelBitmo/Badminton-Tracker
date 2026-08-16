import type { ConsistencyScore, SituationalResponse } from '@badminton/contracts';
import { ANALYTICS_CONSTANTS, type MatchRecord } from './types';
import { aggregate } from './aggregate';
import { deriveMatch, gameResult } from './derive';
import { clamp, percentage, round, standardDeviation } from './math';

/**
 * Consistency score.
 *
 * Method (documented so it is falsifiable, and versioned so it can change):
 *   1. Take the point margin of every game played in the window, signed from the user's
 *      perspective (+3 for 21-18, -4 for 17-21).
 *   2. Compute the population standard deviation σ of those margins.
 *   3. Map σ onto 0–100 with `score = 100 × (1 − σ / σmax)`, clamped to [0, 100], where
 *      σmax is one game's worth of points (21 by default).
 *
 * A score of 100 means every game finished by an identical margin; a score of 0 means
 * results swing by a full game's worth of points. It measures *repeatability*, not
 * strength: a player who always loses 15-21 scores highly and should.
 */
export const CONSISTENCY_METHOD =
  'consistency-v1: 100 × (1 − σ/21) over signed per-game point margins, clamped to 0–100';

export function consistencyScore(matches: readonly MatchRecord[]): ConsistencyScore {
  const margins = matches.flatMap((match) =>
    match.games.map((game) => game.myScore - game.opponentScore),
  );

  if (margins.length < ANALYTICS_CONSTANTS.minGamesForConsistency) {
    return {
      score: null,
      standardDeviation: null,
      meanMargin: null,
      sampleSize: margins.length,
      method: CONSISTENCY_METHOD,
    };
  }

  const sigma = standardDeviation(margins);
  const average = margins.reduce((total, value) => total + value, 0) / margins.length;

  return {
    score:
      sigma === null
        ? null
        : round(clamp(100 * (1 - sigma / ANALYTICS_CONSTANTS.consistencySigmaMax), 0, 100), 1),
    standardDeviation: sigma,
    meanMargin: round(average, 2),
    sampleSize: margins.length,
    method: CONSISTENCY_METHOD,
  };
}

/**
 * Clutch, blowout, decider, comeback and collapse analysis.
 *
 * "Clutch" matches are those where every game finished within `clutchMargin` points;
 * "blowout" matches are those where every game finished by at least `blowoutMargin`.
 * Both are properties of the scoreline, not of the opposition.
 */
export function situationalAnalysis(matches: readonly MatchRecord[]): SituationalResponse {
  const clutch: MatchRecord[] = [];
  const blowout: MatchRecord[] = [];
  const deciders: MatchRecord[] = [];
  const afterWinningFirst: MatchRecord[] = [];
  const afterLosingFirst: MatchRecord[] = [];

  let comebacks = 0;
  let collapses = 0;
  let firstGamesWon = 0;
  let firstGamesLost = 0;

  for (const match of matches) {
    const derived = deriveMatch(match);
    if (derived.isClutch) clutch.push(match);
    if (derived.isBlowout) blowout.push(match);
    if (derived.wentToDecider) deciders.push(match);
    if (derived.isComeback) comebacks += 1;
    if (derived.isCollapse) collapses += 1;

    const firstGame = match.games[0];
    if (!firstGame) continue;
    const firstResult = gameResult(firstGame);
    if (firstResult === 'WIN') {
      firstGamesWon += 1;
      afterWinningFirst.push(match);
    } else if (firstResult === 'LOSS') {
      firstGamesLost += 1;
      afterLosingFirst.push(match);
    }
  }

  return {
    clutch: { thresholdMargin: ANALYTICS_CONSTANTS.clutchMargin, stats: aggregate(clutch) },
    blowout: { thresholdMargin: ANALYTICS_CONSTANTS.blowoutMargin, stats: aggregate(blowout) },
    deciders: aggregate(deciders),
    firstGames: {
      won: firstGamesWon,
      lost: firstGamesLost,
      winRate: percentage(firstGamesWon, firstGamesWon + firstGamesLost),
    },
    comebacks,
    collapses,
    afterWinningFirstGame: aggregate(afterWinningFirst).winRate,
    afterLosingFirstGame: aggregate(afterLosingFirst).winRate,
    consistency: consistencyScore(matches),
  };
}
