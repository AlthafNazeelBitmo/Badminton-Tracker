import { describe, expect, it } from 'vitest';
import { aggregate, computeStreaks } from './aggregate';
import { deriveMatch, formatScoreline } from './derive';
import { games, makeMatch, matchSequence } from './testing/factories';

describe('deriveMatch', () => {
  it('derives a straight-games win', () => {
    const derived = deriveMatch(makeMatch({ games: games('21-18', '21-17') }));
    expect(derived.result).toBe('WIN');
    expect(derived.gamesWon).toBe(2);
    expect(derived.gamesLost).toBe(0);
    expect(derived.pointsScored).toBe(42);
    expect(derived.pointsConceded).toBe(35);
    expect(derived.pointDifferential).toBe(7);
    expect(derived.averagePointsPerGame).toBe(21);
  });

  it('derives a three-game loss', () => {
    const derived = deriveMatch(makeMatch({ games: games('21-18', '17-21', '16-21') }));
    expect(derived.result).toBe('LOSS');
    expect(derived.gamesWon).toBe(1);
    expect(derived.gamesLost).toBe(2);
    expect(derived.pointDifferential).toBe(54 - 60);
  });

  it('flags a comeback: lost the first game, won the match', () => {
    const derived = deriveMatch(makeMatch({ games: games('18-21', '21-15', '21-19') }));
    expect(derived.isComeback).toBe(true);
    expect(derived.isCollapse).toBe(false);
    expect(derived.wentToDecider).toBe(true);
  });

  it('flags a collapse: won the first game, lost the match', () => {
    const derived = deriveMatch(makeMatch({ games: games('21-18', '15-21', '19-21') }));
    expect(derived.isCollapse).toBe(true);
    expect(derived.isComeback).toBe(false);
  });

  it('flags a clutch match when every game finished within three points', () => {
    const derived = deriveMatch(makeMatch({ games: games('21-19', '22-20') }));
    expect(derived.isClutch).toBe(true);
    expect(derived.isBlowout).toBe(false);
    expect(derived.closestGameMargin).toBe(2);
  });

  it('flags a blowout when every game finished by eleven or more', () => {
    const derived = deriveMatch(makeMatch({ games: games('21-8', '21-10') }));
    expect(derived.isBlowout).toBe(true);
    expect(derived.isClutch).toBe(false);
    expect(derived.longestGameMargin).toBe(13);
  });

  it('does not treat a mixed match as clutch or blowout', () => {
    const derived = deriveMatch(makeMatch({ games: games('21-19', '21-5') }));
    expect(derived.isClutch).toBe(false);
    expect(derived.isBlowout).toBe(false);
  });

  it('never reports a decider for a single-game format', () => {
    const derived = deriveMatch(
      makeMatch({
        scoring: { pointsToWin: 21, winBy: 2, maxPoints: 30, bestOf: 1 },
        games: games('21-15'),
      }),
    );
    expect(derived.wentToDecider).toBe(false);
    expect(derived.result).toBe('WIN');
  });

  it('formats a scoreline for display', () => {
    expect(formatScoreline(games('21-18', '19-21', '21-16'))).toBe('21-18, 19-21, 21-16');
  });
});

describe('aggregate', () => {
  it('returns unknown rates rather than zero for an empty set', () => {
    const stats = aggregate([]);
    expect(stats.matches).toBe(0);
    expect(stats.winRate).toBeNull();
    expect(stats.gameWinRate).toBeNull();
    expect(stats.pointWinRate).toBeNull();
    expect(stats.averageWinningMargin).toBeNull();
  });

  it('computes the documented formulas', () => {
    const stats = aggregate([
      makeMatch({ games: games('21-15', '21-17') }), // win, +10
      makeMatch({ games: games('15-21', '17-21') }), // loss, -10
      makeMatch({ games: games('21-18', '18-21', '21-19') }), // win, +2
    ]);

    expect(stats.matches).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(66.7, 1);

    expect(stats.gamesPlayed).toBe(7);
    expect(stats.gamesWon).toBe(4);
    expect(stats.gamesLost).toBe(3);
    expect(stats.gameWinRate).toBeCloseTo(57.1, 1);

    expect(stats.pointsScored).toBe(42 + 32 + 60);
    expect(stats.pointsConceded).toBe(32 + 42 + 58);
    expect(stats.pointDifferential).toBe(2);
    // 134 of 266 total points = 50.376%, rounded to one decimal.
    expect(stats.pointWinRate).toBe(50.4);
  });

  it('averages winning and losing margins per game, not per match', () => {
    const stats = aggregate([makeMatch({ games: games('21-18', '15-21', '21-11') })]);
    // Won games: margins 3 and 10. Lost game: margin 6.
    expect(stats.averageWinningMargin).toBeCloseTo(6.5, 2);
    expect(stats.averageLosingMargin).toBeCloseTo(6, 2);
  });

  it('ignores matches without a duration when averaging match length', () => {
    const stats = aggregate([
      makeMatch({ durationSeconds: 1800 }),
      makeMatch({ durationSeconds: null }),
      makeMatch({ durationSeconds: 2400 }),
    ]);
    expect(stats.playingSeconds).toBe(4200);
    expect(stats.averageMatchSeconds).toBe(2100);
  });

  it('reports null average duration when nothing was timed', () => {
    const stats = aggregate([makeMatch({ durationSeconds: null })]);
    expect(stats.averageMatchSeconds).toBeNull();
    expect(stats.playingSeconds).toBe(0);
  });
});

describe('computeStreaks', () => {
  it('returns zeros for no matches', () => {
    expect(computeStreaks([])).toMatchObject({ currentWinStreak: 0, bestWinStreak: 0, current: 0 });
  });

  it('tracks the current winning run', () => {
    const streaks = computeStreaks(matchSequence(['L', 'W', 'W', 'W']));
    expect(streaks.currentWinStreak).toBe(3);
    expect(streaks.currentLossStreak).toBe(0);
    expect(streaks.current).toBe(3);
  });

  it('tracks the current losing run as a negative value', () => {
    const streaks = computeStreaks(matchSequence(['W', 'W', 'L', 'L']));
    expect(streaks.currentLossStreak).toBe(2);
    expect(streaks.current).toBe(-2);
  });

  it('remembers the best and worst runs from anywhere in the history', () => {
    const streaks = computeStreaks(matchSequence(['W', 'W', 'W', 'W', 'L', 'L', 'L', 'W']));
    expect(streaks.bestWinStreak).toBe(4);
    expect(streaks.worstLossStreak).toBe(3);
    expect(streaks.currentWinStreak).toBe(1);
  });

  it('orders by played date regardless of input order', () => {
    const ordered = matchSequence(['L', 'W', 'W']);
    const shuffled = [ordered[2]!, ordered[0]!, ordered[1]!];
    expect(computeStreaks(shuffled).currentWinStreak).toBe(2);
  });

  it('breaks ties within a session using the recorded match order', () => {
    const at = new Date('2026-03-01T18:00:00.000Z');
    const first = makeMatch({ playedAt: at, orderInSession: 1, games: games('21-10', '21-10') });
    const second = makeMatch({ playedAt: at, orderInSession: 2, games: games('10-21', '10-21') });
    expect(computeStreaks([second, first]).current).toBe(-1);
  });
});
