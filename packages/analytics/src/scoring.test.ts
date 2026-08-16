import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCORING_RULES,
  SCORING_PRESETS,
  gamesRequiredToWin,
  validateGameScore,
  validateMatchGames,
  validateScoringRules,
  type ScoringRules,
} from '@badminton/contracts';
import { games } from './testing/factories';

const bwf = DEFAULT_SCORING_RULES;

describe('validateGameScore under BWF rules (21, win by 2, cap 30)', () => {
  it.each([
    ['21-0', 21, 0],
    ['21-15', 21, 15],
    ['21-19', 21, 19],
    ['22-20', 22, 20],
    ['25-23', 25, 23],
    ['29-27', 29, 27],
    ['30-29', 30, 29],
    ['30-28', 30, 28],
    ['18-21', 18, 21],
    ['20-22', 20, 22],
  ])('accepts %s', (_label, myScore, opponentScore) => {
    expect(validateGameScore({ myScore, opponentScore }, bwf).valid).toBe(true);
  });

  it.each([
    ['a tied game', 21, 21, 'GAME_TIED'],
    ['an unfinished game', 19, 17, 'GAME_INCOMPLETE'],
    ['a one-point win at the target', 21, 20, 'GAME_IMPOSSIBLE_SCORE'],
    ['a deuce win by more than two', 23, 19, 'GAME_IMPOSSIBLE_SCORE'],
    ['a score above the cap', 31, 29, 'SCORE_ABOVE_CAP'],
    ['a negative score', 21, -1, 'SCORE_NEGATIVE'],
    ['a fractional score', 21.5, 18, 'SCORE_NOT_INTEGER'],
  ])('rejects %s', (_label, myScore, opponentScore, code) => {
    const result = validateGameScore({ myScore, opponentScore }, bwf);
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.code).toBe(code);
  });

  it('reports the offending game index', () => {
    const result = validateGameScore({ myScore: 21, opponentScore: 20 }, bwf, 2);
    expect(result.issues[0]?.gameIndex).toBe(2);
  });
});

describe('validateGameScore with custom formats', () => {
  it('honours a 15-point social format', () => {
    const rules = SCORING_PRESETS.SOCIAL_15 as ScoringRules;
    expect(validateGameScore({ myScore: 15, opponentScore: 12 }, rules).valid).toBe(true);
    expect(validateGameScore({ myScore: 21, opponentScore: 12 }, rules).valid).toBe(false);
    expect(validateGameScore({ myScore: 21, opponentScore: 19 }, rules).valid).toBe(true);
  });

  it('allows a one-point win when deuce is disabled', () => {
    const rules = SCORING_PRESETS.SUDDEN_DEATH_21 as ScoringRules;
    expect(validateGameScore({ myScore: 21, opponentScore: 20 }, rules).valid).toBe(true);
  });
});

describe('validateScoringRules', () => {
  it('accepts every shipped preset', () => {
    for (const preset of Object.values(SCORING_PRESETS)) {
      expect(validateScoringRules(preset).valid).toBe(true);
    }
  });

  it('rejects a cap below the target', () => {
    const result = validateScoringRules({ pointsToWin: 21, winBy: 2, maxPoints: 15, bestOf: 3 });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('MAX_POINTS_TOO_LOW');
  });

  it('rejects non-integer configuration', () => {
    const result = validateScoringRules({ pointsToWin: 21.5, winBy: 2, maxPoints: 30, bestOf: 3 });
    expect(result.valid).toBe(false);
  });
});

describe('gamesRequiredToWin', () => {
  it.each([
    [1, 1],
    [3, 2],
    [5, 3],
    [7, 4],
  ])('best of %i requires %i games', (bestOf, expected) => {
    expect(gamesRequiredToWin({ bestOf })).toBe(expected);
  });
});

describe('validateMatchGames', () => {
  it('accepts a straight-games win', () => {
    expect(validateMatchGames(games('21-15', '21-17'), bwf).valid).toBe(true);
  });

  it('accepts a three-game match', () => {
    expect(validateMatchGames(games('21-18', '19-21', '21-16'), bwf).valid).toBe(true);
  });

  it('rejects a match with no games', () => {
    const result = validateMatchGames([], bwf);
    expect(result.issues[0]?.code).toBe('MATCH_NO_GAMES');
  });

  it('rejects more games than the format allows', () => {
    const result = validateMatchGames(games('21-18', '19-21', '21-16', '21-10'), bwf);
    expect(result.issues.map((issue) => issue.code)).toContain('MATCH_TOO_MANY_GAMES');
  });

  it('rejects a game recorded after the match was already decided', () => {
    const result = validateMatchGames(games('21-15', '21-17', '21-10'), bwf);
    expect(result.issues.map((issue) => issue.code)).toContain('MATCH_GAME_AFTER_DECISION');
  });

  it('rejects an undecided match', () => {
    const result = validateMatchGames(games('21-15'), bwf);
    expect(result.issues.map((issue) => issue.code)).toContain('MATCH_UNDECIDED');
  });

  it('accepts a single-game format', () => {
    const rules = SCORING_PRESETS.BWF_SINGLE_GAME as ScoringRules;
    expect(validateMatchGames(games('21-15'), rules).valid).toBe(true);
  });

  it('surfaces the invalid game alongside its index', () => {
    const result = validateMatchGames(games('21-15', '21-20'), bwf);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.gameIndex === 1)).toBe(true);
  });
});
