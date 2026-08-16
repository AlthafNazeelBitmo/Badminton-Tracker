import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATING_CONFIG,
  expectedScore,
  ratingDeviation,
  replayRatings,
  summariseRating,
} from './rating';
import { achievementCounters, countPerfectSessions, personalRecords } from './records';
import { games, makeMatch, matchSequence } from './testing/factories';

describe('expectedScore', () => {
  it('is 0.5 between equally rated sides', () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 10);
  });

  it('is about 0.76 with a 200-point advantage', () => {
    expect(expectedScore(1400, 1200)).toBeCloseTo(0.7597, 3);
  });

  it('is symmetric', () => {
    expect(expectedScore(1300, 1100) + expectedScore(1100, 1300)).toBeCloseTo(1, 10);
  });
});

describe('replayRatings', () => {
  it('leaves the rating untouched when there are no matches', () => {
    const replay = replayRatings([]);
    expect(replay.userRating.rating).toBe(DEFAULT_RATING_CONFIG.startingRating);
    expect(replay.events).toHaveLength(0);
  });

  it('raises the rating on a win and lowers it on a loss', () => {
    const win = replayRatings(matchSequence(['W']));
    expect(win.userRating.rating).toBeGreaterThan(DEFAULT_RATING_CONFIG.startingRating);

    const loss = replayRatings(matchSequence(['L']));
    expect(loss.userRating.rating).toBeLessThan(DEFAULT_RATING_CONFIG.startingRating);
  });

  it('moves the opponent by the mirror image of the user', () => {
    const replay = replayRatings(matchSequence(['W']));
    const opponent = replay.playerRatings.get('opponent-1');
    const userGain = replay.userRating.rating - DEFAULT_RATING_CONFIG.startingRating;
    const opponentLoss = DEFAULT_RATING_CONFIG.startingRating - (opponent?.rating ?? 0);
    expect(opponentLoss).toBeCloseTo(userGain, 1);
  });

  it('uses the provisional K-factor for early matches', () => {
    const replay = replayRatings(matchSequence(['W', 'W']));
    expect(replay.events[0]?.kFactor).toBe(DEFAULT_RATING_CONFIG.provisionalKFactor);
  });

  it('settles onto the stable K-factor after the provisional window', () => {
    const results: Array<'W' | 'L'> = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0 ? 'W' : 'L',
    );
    const replay = replayRatings(matchSequence(results));
    expect(replay.events[11]?.kFactor).toBe(DEFAULT_RATING_CONFIG.kFactor);
  });

  it('awards less for beating a weaker opponent than a stronger one', () => {
    // Beat the same opponent repeatedly: their rating falls, so later wins are worth less.
    const replay = replayRatings(matchSequence(['W', 'W', 'W', 'W']));
    const first = replay.events[0]?.delta ?? 0;
    const last = replay.events[3]?.delta ?? 0;
    expect(last).toBeLessThan(first);
  });

  it('keeps ratings inside the configured bounds', () => {
    const replay = replayRatings(matchSequence(Array.from({ length: 200 }, () => 'W' as const)));
    expect(replay.userRating.rating).toBeLessThanOrEqual(DEFAULT_RATING_CONFIG.maxRating);
  });

  it('records a rating event per match with a consistent before/after chain', () => {
    const replay = replayRatings(matchSequence(['W', 'L', 'W']));
    expect(replay.events).toHaveLength(3);
    expect(replay.events[1]?.ratingBefore).toBeCloseTo(replay.events[0]!.ratingAfter, 1);
    expect(replay.events[2]?.ratingBefore).toBeCloseTo(replay.events[1]!.ratingAfter, 1);
  });

  it('tracks discipline ratings separately', () => {
    const replay = replayRatings([
      makeMatch({ discipline: 'SINGLES', games: games('21-10', '21-10') }),
      makeMatch({
        discipline: 'DOUBLES',
        partnerIds: ['partner-1'],
        opponentIds: ['opponent-1', 'opponent-2'],
        games: games('10-21', '10-21'),
      }),
    ]);
    expect(replay.userRatingByDiscipline.SINGLES.rating).toBeGreaterThan(1200);
    expect(replay.userRatingByDiscipline.DOUBLES.rating).toBeLessThan(1200);
  });
});

describe('summariseRating', () => {
  it('always carries the not-an-official-ranking disclaimer', () => {
    const summary = summariseRating(replayRatings(matchSequence(['W'])));
    expect(summary.disclaimer).toMatch(/not an official badminton ranking/i);
  });

  it('narrows the deviation as matches accumulate', () => {
    expect(ratingDeviation(0)).toBe(DEFAULT_RATING_CONFIG.startingDeviation);
    expect(ratingDeviation(5)).toBeLessThan(ratingDeviation(0));
    expect(ratingDeviation(1000)).toBe(DEFAULT_RATING_CONFIG.minDeviation);
  });
});

describe('records and counters', () => {
  const context = { timeZone: 'UTC', playerName: (id: string) => `Player ${id}` };

  it('returns nothing for an empty history', () => {
    expect(personalRecords([], context)).toEqual([]);
  });

  it('finds the highest scoring game and the largest winning margin', () => {
    const records = personalRecords(
      [makeMatch({ games: games('30-29', '21-19') }), makeMatch({ games: games('21-2', '21-3') })],
      context,
    );

    expect(records.find((record) => record.code === 'HIGHEST_SCORING_GAME')?.value).toBe('30-29');
    expect(records.find((record) => record.code === 'LARGEST_WINNING_MARGIN')?.value).toBe('21-2');
    expect(records.find((record) => record.code === 'CLOSEST_WIN')?.value).toBe('30-29');
  });

  it('identifies the biggest comeback by first-game deficit', () => {
    const records = personalRecords(
      [
        makeMatch({ games: games('19-21', '21-15', '21-16') }),
        makeMatch({ games: games('5-21', '21-15', '21-16') }),
      ],
      context,
    );
    const comeback = records.find((record) => record.code === 'BIGGEST_COMEBACK');
    expect(comeback?.detail).toMatch(/by 16/);
  });

  it('counts a perfect session only when it is long enough', () => {
    const shortSession = [
      makeMatch({ sessionId: 'a', games: games('21-10', '21-10') }),
      makeMatch({ sessionId: 'a', games: games('21-10', '21-10') }),
    ];
    expect(countPerfectSessions(shortSession)).toBe(0);

    const fullSession = [
      ...shortSession,
      makeMatch({ sessionId: 'a', games: games('21-10', '21-10') }),
    ];
    expect(countPerfectSessions(fullSession)).toBe(1);
  });

  it('does not count a session containing a loss as perfect', () => {
    expect(
      countPerfectSessions([
        makeMatch({ sessionId: 'a', games: games('21-10', '21-10') }),
        makeMatch({ sessionId: 'a', games: games('21-10', '21-10') }),
        makeMatch({ sessionId: 'a', games: games('10-21', '10-21') }),
      ]),
    ).toBe(0);
  });

  it('produces achievement counters from raw matches', () => {
    const counters = achievementCounters([
      makeMatch({
        sessionId: 's1',
        venueId: 'v1',
        opponentIds: ['o1'],
        games: games('21-10', '21-10'),
      }),
      makeMatch({
        sessionId: 's1',
        venueId: 'v1',
        opponentIds: ['o2'],
        games: games('18-21', '21-10', '21-10'),
      }),
      makeMatch({
        sessionId: 's2',
        venueId: 'v2',
        opponentIds: ['o1'],
        games: games('10-21', '10-21'),
      }),
    ]);

    expect(counters.matchesPlayed).toBe(3);
    expect(counters.matchesWon).toBe(2);
    expect(counters.sessionsPlayed).toBe(2);
    expect(counters.distinctOpponents).toBe(2);
    expect(counters.distinctVenues).toBe(2);
    expect(counters.comebacks).toBe(1);
    expect(counters.bestWinStreak).toBe(2);
  });
});
