import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_RULES,
  SCORING_PRESETS,
  describeRules,
  gamesRequiredToWin,
  playersPerSide,
  validateGameScore,
  validateMatchGames,
  validateScoringRules,
  type ScoringRules,
} from './scoring';

/**
 * These rules are the foundation the whole platform derives from: a score the validator
 * wrongly accepts becomes a permanent, wrong row in the match history, and every statistic
 * computed from it inherits the error. The awkward cases — deuce, the cap, a match that
 * stopped early — are where a plausible-looking implementation goes wrong, so they are
 * what this file spends its time on.
 */

const bwf = DEFAULT_SCORING_RULES;
const codesOf = (result: { issues: Array<{ code: string }> }) =>
  result.issues.map((issue) => issue.code);

describe('gamesRequiredToWin', () => {
  it('is a simple majority of the format', () => {
    expect(gamesRequiredToWin({ bestOf: 1 })).toBe(1);
    expect(gamesRequiredToWin({ bestOf: 3 })).toBe(2);
    expect(gamesRequiredToWin({ bestOf: 5 })).toBe(3);
  });
});

describe('validateScoringRules', () => {
  it('accepts every shipped preset', () => {
    for (const [name, rules] of Object.entries(SCORING_PRESETS)) {
      const result = validateScoringRules(rules);
      expect(result.valid, `${name} should be a valid preset`).toBe(true);
    }
  });

  it('rejects a cap below the target, which no game could ever reach', () => {
    const result = validateScoringRules({ ...bwf, pointsToWin: 21, maxPoints: 15 });
    expect(codesOf(result)).toContain('MAX_POINTS_TOO_LOW');
  });

  it('rejects non-integer rules before checking ranges', () => {
    const result = validateScoringRules({ ...bwf, pointsToWin: 21.5 });
    expect(codesOf(result)).toEqual(['RULE_NOT_INTEGER']);
  });

  it('reports every out-of-range field at once rather than the first', () => {
    const result = validateScoringRules({
      pointsToWin: 0,
      winBy: 0,
      maxPoints: 500,
      bestOf: 40,
    });

    // A form should be able to mark all four fields in one pass.
    expect(codesOf(result)).toEqual(
      expect.arrayContaining([
        'POINTS_TO_WIN_OUT_OF_RANGE',
        'WIN_BY_OUT_OF_RANGE',
        'MAX_POINTS_TOO_HIGH',
        'BEST_OF_OUT_OF_RANGE',
      ]),
    );
  });
});

describe('validateGameScore under BWF rules', () => {
  const accepted: Array<[number, number, string]> = [
    [21, 0, 'a whitewash'],
    [21, 19, 'the last score winnable at the target'],
    [22, 20, 'the first score requiring deuce'],
    [24, 22, 'a long deuce'],
    [29, 27, 'the last deuce below the cap'],
    [30, 29, 'the cap, won by one'],
    [30, 28, 'the cap, reached with a two-point margin'],
    [19, 21, 'a loss recorded from the user’s side'],
  ];

  it.each(accepted)('accepts %i-%i (%s)', (myScore, opponentScore) => {
    expect(validateGameScore({ myScore, opponentScore }, bwf).valid).toBe(true);
  });

  const rejected: Array<[number, number, string, string]> = [
    [21, 21, 'a level game', 'GAME_TIED'],
    [20, 18, 'nobody reached the target', 'GAME_INCOMPLETE'],
    [23, 19, 'deuce continuing past a two-point lead', 'GAME_IMPOSSIBLE_SCORE'],
    [25, 0, 'a score past the target with no deuce to justify it', 'GAME_IMPOSSIBLE_SCORE'],
    [31, 29, 'a score above the cap', 'SCORE_ABOVE_CAP'],
    [21, -1, 'a negative score', 'SCORE_NEGATIVE'],
    [21.5, 19, 'a fractional score', 'SCORE_NOT_INTEGER'],
  ];

  it.each(rejected)('rejects %i-%i (%s)', (myScore, opponentScore, _reason, code) => {
    const result = validateGameScore({ myScore, opponentScore }, bwf);
    expect(result.valid).toBe(false);
    expect(codesOf(result)).toContain(code);
  });

  it('tags the issue with the game it came from', () => {
    const result = validateGameScore({ myScore: 21, opponentScore: 21 }, bwf, 2);
    expect(result.issues[0]?.gameIndex).toBe(2);
  });
});

describe('validateGameScore under other formats', () => {
  it('honours sudden death, where a one-point win at the target is legal', () => {
    const sudden = SCORING_PRESETS.SUDDEN_DEATH_21 as ScoringRules;
    expect(validateGameScore({ myScore: 21, opponentScore: 20 }, sudden).valid).toBe(true);
    // With no cap above the target there is nothing to play past 21.
    expect(validateGameScore({ myScore: 22, opponentScore: 20 }, sudden).valid).toBe(false);
  });

  it('honours a social 15-point game with its own cap', () => {
    const social = SCORING_PRESETS.SOCIAL_15 as ScoringRules;
    expect(validateGameScore({ myScore: 15, opponentScore: 13 }, social).valid).toBe(true);
    expect(validateGameScore({ myScore: 21, opponentScore: 20 }, social).valid).toBe(true);
    // 21 is this format's cap, so nothing beyond it exists.
    expect(validateGameScore({ myScore: 22, opponentScore: 20 }, social).valid).toBe(false);
  });

  it('rejects a score that is only legal under a different format', () => {
    // 24-22 is an ordinary BWF deuce and unreachable at 15 points, where the cap is 21.
    // This is the reason every match stores the rules it was played under: judging an old
    // match against the user's current default would retroactively invalidate it.
    expect(validateGameScore({ myScore: 24, opponentScore: 22 }, bwf).valid).toBe(true);
    expect(
      validateGameScore(
        { myScore: 24, opponentScore: 22 },
        SCORING_PRESETS.SOCIAL_15 as ScoringRules,
      ).valid,
    ).toBe(false);
  });
});

describe('validateMatchGames', () => {
  it('accepts a straight-games win', () => {
    const result = validateMatchGames(
      [
        { myScore: 21, opponentScore: 15 },
        { myScore: 21, opponentScore: 17 },
      ],
      bwf,
    );
    expect(result.valid).toBe(true);
  });

  it('accepts a three-game comeback', () => {
    const result = validateMatchGames(
      [
        { myScore: 18, opponentScore: 21 },
        { myScore: 21, opponentScore: 19 },
        { myScore: 21, opponentScore: 18 },
      ],
      bwf,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a third game played after the match was already won', () => {
    const result = validateMatchGames(
      [
        { myScore: 21, opponentScore: 15 },
        { myScore: 21, opponentScore: 17 },
        { myScore: 21, opponentScore: 19 },
      ],
      bwf,
    );

    expect(codesOf(result)).toContain('MATCH_GAME_AFTER_DECISION');
  });

  it('rejects a match abandoned before either side had won it', () => {
    const result = validateMatchGames(
      [
        { myScore: 21, opponentScore: 15 },
        { myScore: 18, opponentScore: 21 },
      ],
      bwf,
    );

    // One game each in a best-of-three: the decider is missing.
    expect(codesOf(result)).toContain('MATCH_UNDECIDED');
  });

  it('rejects more games than the format allows', () => {
    const result = validateMatchGames(
      [
        { myScore: 21, opponentScore: 15 },
        { myScore: 21, opponentScore: 17 },
        { myScore: 21, opponentScore: 18 },
        { myScore: 21, opponentScore: 19 },
      ],
      bwf,
    );

    expect(codesOf(result)).toContain('MATCH_TOO_MANY_GAMES');
  });

  it('rejects a match with no games at all', () => {
    expect(codesOf(validateMatchGames([], bwf))).toEqual(['MATCH_NO_GAMES']);
  });

  it('accepts a single-game format decided in one game', () => {
    const single = SCORING_PRESETS.BWF_SINGLE_GAME as ScoringRules;
    expect(validateMatchGames([{ myScore: 21, opponentScore: 12 }], single).valid).toBe(true);
  });

  it('reports the offending game rather than just failing the match', () => {
    const result = validateMatchGames(
      [
        { myScore: 21, opponentScore: 15 },
        { myScore: 23, opponentScore: 19 },
        { myScore: 21, opponentScore: 18 },
      ],
      bwf,
    );

    const impossible = result.issues.find((issue) => issue.code === 'GAME_IMPOSSIBLE_SCORE');
    expect(impossible?.gameIndex).toBe(1);
  });

  it('refuses to judge games against rules that are themselves invalid', () => {
    const result = validateMatchGames([{ myScore: 21, opponentScore: 15 }], {
      ...bwf,
      maxPoints: 5,
    });

    // Reporting the game as impossible would blame the data for a broken configuration.
    expect(codesOf(result)).toEqual(['MAX_POINTS_TOO_LOW']);
  });
});

describe('describeRules', () => {
  it('describes a deuce format and a sudden-death format differently', () => {
    expect(describeRules(bwf)).toBe('best of 3 to 21 (win by 2, cap 30)');
    expect(describeRules(SCORING_PRESETS.SUDDEN_DEATH_21 as ScoringRules)).toBe(
      'best of 3 to 21 (sudden death)',
    );
  });
});

describe('playersPerSide', () => {
  it('is one for singles and two for every doubles discipline', () => {
    expect(playersPerSide('SINGLES')).toBe(1);
    expect(playersPerSide('DOUBLES')).toBe(2);
    expect(playersPerSide('MIXED_DOUBLES')).toBe(2);
  });
});
