import type { Discipline } from './enums';

/**
 * A configurable badminton scoring format.
 *
 * Nothing about "21 points, best of 3" is hardcoded anywhere in the platform: every
 * match stores the rules it was played under, so historical data stays correct when a
 * user changes their default format (or plays a one-off 15-point social game).
 *
 * - `pointsToWin` – the base target, e.g. 21.
 * - `winBy`       – required margin once the target is reached, e.g. 2 (deuce).
 * - `maxPoints`   – hard cap at which a one-point margin wins, e.g. 30. Set equal to
 *                   `pointsToWin` to disable deuce entirely.
 * - `bestOf`      – number of games in the match, e.g. 1, 3 or 5.
 */
export interface ScoringRules {
  pointsToWin: number;
  winBy: number;
  maxPoints: number;
  bestOf: number;
}

/** BWF standard rally scoring. */
export const DEFAULT_SCORING_RULES: ScoringRules = {
  pointsToWin: 21,
  winBy: 2,
  maxPoints: 30,
  bestOf: 3,
};

export const SCORING_PRESETS: Record<string, ScoringRules> = {
  BWF_BEST_OF_3: { pointsToWin: 21, winBy: 2, maxPoints: 30, bestOf: 3 },
  BWF_SINGLE_GAME: { pointsToWin: 21, winBy: 2, maxPoints: 30, bestOf: 1 },
  SOCIAL_15: { pointsToWin: 15, winBy: 2, maxPoints: 21, bestOf: 3 },
  SOCIAL_11: { pointsToWin: 11, winBy: 2, maxPoints: 15, bestOf: 3 },
  SUDDEN_DEATH_21: { pointsToWin: 21, winBy: 1, maxPoints: 21, bestOf: 3 },
};

/** Absolute bounds used to keep obviously nonsensical configurations out of the database. */
export const SCORING_LIMITS = {
  minPointsToWin: 1,
  maxPointsToWin: 100,
  minWinBy: 1,
  maxWinBy: 10,
  maxMaxPoints: 200,
  minBestOf: 1,
  maxBestOf: 9,
} as const;

export interface ScoreLine {
  /** Points scored by the owning user's side. */
  myScore: number;
  /** Points scored by the opposing side. */
  opponentScore: number;
}

export type ValidationIssue = {
  code: string;
  message: string;
  /** Index of the offending game, when the issue is game-specific. */
  gameIndex?: number;
};

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const ok: ValidationResult = { valid: true, issues: [] };

/** Number of games a side must win to take the match. */
export function gamesRequiredToWin(rules: Pick<ScoringRules, 'bestOf'>): number {
  return Math.floor(rules.bestOf / 2) + 1;
}

/** Validates the scoring configuration itself. */
export function validateScoringRules(rules: ScoringRules): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { pointsToWin, winBy, maxPoints, bestOf } = rules;

  for (const [key, value] of Object.entries(rules)) {
    if (!Number.isInteger(value)) {
      issues.push({ code: 'RULE_NOT_INTEGER', message: `${key} must be a whole number.` });
    }
  }
  if (issues.length > 0) return { valid: false, issues };

  if (pointsToWin < SCORING_LIMITS.minPointsToWin || pointsToWin > SCORING_LIMITS.maxPointsToWin) {
    issues.push({
      code: 'POINTS_TO_WIN_OUT_OF_RANGE',
      message: `pointsToWin must be between ${SCORING_LIMITS.minPointsToWin} and ${SCORING_LIMITS.maxPointsToWin}.`,
    });
  }
  if (winBy < SCORING_LIMITS.minWinBy || winBy > SCORING_LIMITS.maxWinBy) {
    issues.push({
      code: 'WIN_BY_OUT_OF_RANGE',
      message: `winBy must be between ${SCORING_LIMITS.minWinBy} and ${SCORING_LIMITS.maxWinBy}.`,
    });
  }
  if (maxPoints < pointsToWin) {
    issues.push({
      code: 'MAX_POINTS_TOO_LOW',
      message: 'maxPoints must be greater than or equal to pointsToWin.',
    });
  }
  if (maxPoints > SCORING_LIMITS.maxMaxPoints) {
    issues.push({
      code: 'MAX_POINTS_TOO_HIGH',
      message: `maxPoints must not exceed ${SCORING_LIMITS.maxMaxPoints}.`,
    });
  }
  if (bestOf < SCORING_LIMITS.minBestOf || bestOf > SCORING_LIMITS.maxBestOf) {
    issues.push({
      code: 'BEST_OF_OUT_OF_RANGE',
      message: `bestOf must be between ${SCORING_LIMITS.minBestOf} and ${SCORING_LIMITS.maxBestOf}.`,
    });
  }

  return issues.length === 0 ? ok : { valid: false, issues };
}

/**
 * Validates a single completed game against the given rules.
 *
 * A game is legal when the winner reached the target and either:
 *  - won exactly at the target with a sufficient margin, or
 *  - won after deuce by exactly `winBy`, or
 *  - won at the hard cap by at least one point.
 *
 * This accepts 21-19, 22-20 and 30-29 while rejecting 21-21, 23-19 and 25-0.
 */
export function validateGameScore(
  score: ScoreLine,
  rules: ScoringRules,
  gameIndex?: number,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const push = (code: string, message: string) => issues.push({ code, message, gameIndex });

  const { myScore, opponentScore } = score;

  if (!Number.isInteger(myScore) || !Number.isInteger(opponentScore)) {
    push('SCORE_NOT_INTEGER', 'Scores must be whole numbers.');
    return { valid: false, issues };
  }
  if (myScore < 0 || opponentScore < 0) {
    push('SCORE_NEGATIVE', 'Scores cannot be negative.');
    return { valid: false, issues };
  }
  if (myScore > rules.maxPoints || opponentScore > rules.maxPoints) {
    push('SCORE_ABOVE_CAP', `Scores cannot exceed the cap of ${rules.maxPoints}.`);
    return { valid: false, issues };
  }

  const high = Math.max(myScore, opponentScore);
  const low = Math.min(myScore, opponentScore);
  const margin = high - low;

  if (margin === 0) {
    push('GAME_TIED', 'A game cannot end level.');
    return { valid: false, issues };
  }
  if (high < rules.pointsToWin) {
    push('GAME_INCOMPLETE', `The winning side must reach at least ${rules.pointsToWin} points.`);
    return { valid: false, issues };
  }

  const wonAtTarget = high === rules.pointsToWin && margin >= rules.winBy;
  const wonAfterDeuce =
    high > rules.pointsToWin && high < rules.maxPoints && margin === rules.winBy;
  const wonAtCap = high === rules.maxPoints && margin >= 1 && margin <= rules.winBy;

  if (!wonAtTarget && !wonAfterDeuce && !wonAtCap) {
    push(
      'GAME_IMPOSSIBLE_SCORE',
      `${myScore}-${opponentScore} is not reachable under ${describeRules(rules)}.`,
    );
  }

  return issues.length === 0 ? ok : { valid: false, issues };
}

/**
 * Validates the structure of a full match: every game legal, the right number of games
 * played, and no games recorded after the match was already decided.
 */
export function validateMatchGames(games: ScoreLine[], rules: ScoringRules): ValidationResult {
  const rulesCheck = validateScoringRules(rules);
  if (!rulesCheck.valid) return rulesCheck;

  const issues: ValidationIssue[] = [];

  if (games.length === 0) {
    issues.push({ code: 'MATCH_NO_GAMES', message: 'A match must contain at least one game.' });
    return { valid: false, issues };
  }
  if (games.length > rules.bestOf) {
    issues.push({
      code: 'MATCH_TOO_MANY_GAMES',
      message: `A best-of-${rules.bestOf} match cannot contain ${games.length} games.`,
    });
  }

  const needed = gamesRequiredToWin(rules);
  let myGames = 0;
  let opponentGames = 0;
  let decidedAt: number | null = null;

  games.forEach((game, index) => {
    const gameCheck = validateGameScore(game, rules, index);
    if (!gameCheck.valid) issues.push(...gameCheck.issues);

    if (decidedAt !== null) {
      issues.push({
        code: 'MATCH_GAME_AFTER_DECISION',
        message: `Game ${index + 1} was recorded after the match had already been won in game ${decidedAt + 1}.`,
        gameIndex: index,
      });
      return;
    }

    if (game.myScore > game.opponentScore) myGames += 1;
    else if (game.opponentScore > game.myScore) opponentGames += 1;

    if (myGames === needed || opponentGames === needed) decidedAt = index;
  });

  if (decidedAt === null && games.length < rules.bestOf) {
    issues.push({
      code: 'MATCH_UNDECIDED',
      message: `Neither side has won ${needed} game(s); the match is incomplete.`,
    });
  }

  return issues.length === 0 ? ok : { valid: false, issues };
}

/** Human-readable summary of a format, used in error messages and the UI. */
export function describeRules(rules: ScoringRules): string {
  const deuce =
    rules.maxPoints > rules.pointsToWin
      ? `win by ${rules.winBy}, cap ${rules.maxPoints}`
      : 'sudden death';
  return `best of ${rules.bestOf} to ${rules.pointsToWin} (${deuce})`;
}

/** Convenience guard used when building match participants. */
export function playersPerSide(discipline: Discipline): number {
  return discipline === 'SINGLES' ? 1 : 2;
}
