import { gamesRequiredToWin, type MatchDerived, type ScoreLine } from '@badminton/contracts';
import { ANALYTICS_CONSTANTS, type MatchRecord, type SeriesResult } from './types';
import { round, sum } from './math';

/** Result of a single game from the user's perspective. */
export function gameResult(game: ScoreLine): SeriesResult {
  if (game.myScore > game.opponentScore) return 'WIN';
  if (game.myScore < game.opponentScore) return 'LOSS';
  return 'DRAW';
}

export function gameMargin(game: ScoreLine): number {
  return Math.abs(game.myScore - game.opponentScore);
}

/**
 * Derives every per-match number from the raw games.
 *
 * This is the single place a match result is decided. Nothing else in the platform is
 * allowed to infer a win from anything other than this function, which is why the same
 * function is used by the write path (to persist the denormalised `result` column) and
 * by the recompute command.
 */
export function deriveMatch(match: Pick<MatchRecord, 'games' | 'scoring'>): MatchDerived {
  const { games, scoring } = match;

  const gamesWon = games.filter((game) => gameResult(game) === 'WIN').length;
  const gamesLost = games.filter((game) => gameResult(game) === 'LOSS').length;
  const pointsScored = sum(games.map((game) => game.myScore));
  const pointsConceded = sum(games.map((game) => game.opponentScore));

  let result: SeriesResult = 'DRAW';
  if (gamesWon > gamesLost) result = 'WIN';
  else if (gamesLost > gamesWon) result = 'LOSS';

  const margins = games.map(gameMargin);
  const firstGame = games[0];
  const firstGameResult = firstGame ? gameResult(firstGame) : 'DRAW';

  const required = gamesRequiredToWin(scoring);
  // A "decider" is the last game a format allows, reached only because the match was level.
  const wentToDecider = scoring.bestOf > 1 && games.length === scoring.bestOf && required > 1;

  return {
    result,
    gamesWon,
    gamesLost,
    pointsScored,
    pointsConceded,
    pointDifferential: pointsScored - pointsConceded,
    averagePointsPerGame: games.length === 0 ? 0 : round(pointsScored / games.length, 2),
    margin: Math.abs(pointsScored - pointsConceded),
    isComeback: result === 'WIN' && firstGameResult === 'LOSS',
    isCollapse: result === 'LOSS' && firstGameResult === 'WIN',
    wentToDecider,
    isClutch:
      games.length > 0 && margins.every((margin) => margin <= ANALYTICS_CONSTANTS.clutchMargin),
    isBlowout:
      games.length > 0 && margins.every((margin) => margin >= ANALYTICS_CONSTANTS.blowoutMargin),
    longestGameMargin: margins.length === 0 ? 0 : Math.max(...margins),
    closestGameMargin: margins.length === 0 ? 0 : Math.min(...margins),
  };
}

/** The decider game of a match, when the format has one and it was reached. */
export function deciderGame(match: Pick<MatchRecord, 'games' | 'scoring'>): ScoreLine | null {
  const derived = deriveMatch(match);
  if (!derived.wentToDecider) return null;
  return match.games[match.games.length - 1] ?? null;
}

/** Formats a match as `21-18, 19-21, 21-16` for display and export. */
export function formatScoreline(games: readonly ScoreLine[]): string {
  return games.map((game) => `${game.myScore}-${game.opponentScore}`).join(', ');
}
