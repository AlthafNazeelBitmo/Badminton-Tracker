import { describe, expect, it } from 'vitest';
import { consistencyScore, situationalAnalysis } from './situational';
import { fatigueAnalysis } from './fatigue';
import { buildTrend } from './trends';
import { tagCorrelations } from './breakdowns';
import { games, makeMatch } from './testing/factories';

describe('consistencyScore', () => {
  it('withholds a score below the minimum sample size', () => {
    const result = consistencyScore([makeMatch({ games: games('21-18', '21-17') })]);
    expect(result.score).toBeNull();
    expect(result.sampleSize).toBe(2);
  });

  it('scores identical margins as perfectly consistent', () => {
    const matches = Array.from({ length: 3 }, () => makeMatch({ games: games('21-18', '21-18') }));
    const result = consistencyScore(matches);
    expect(result.standardDeviation).toBe(0);
    expect(result.score).toBe(100);
    expect(result.meanMargin).toBe(3);
  });

  it('scores swinging margins lower than steady ones', () => {
    const steady = Array.from({ length: 3 }, () => makeMatch({ games: games('21-18', '21-17') }));
    const swinging = [
      makeMatch({ games: games('21-2', '21-3') }),
      makeMatch({ games: games('2-21', '3-21') }),
      makeMatch({ games: games('21-19', '21-19') }),
    ];
    expect(consistencyScore(steady).score!).toBeGreaterThan(consistencyScore(swinging).score!);
  });

  it('publishes the method it used', () => {
    expect(consistencyScore([]).method).toMatch(/consistency-v1/);
  });
});

describe('situationalAnalysis', () => {
  const matches = [
    makeMatch({ games: games('21-19', '21-18') }), // clutch win
    makeMatch({ games: games('19-21', '18-21') }), // clutch loss
    makeMatch({ games: games('21-8', '21-9') }), // blowout win
    makeMatch({ games: games('18-21', '21-15', '21-19') }), // comeback, decider
    makeMatch({ games: games('21-18', '15-21', '19-21') }), // collapse, decider
  ];

  it('counts comebacks and collapses', () => {
    const result = situationalAnalysis(matches);
    expect(result.comebacks).toBe(1);
    expect(result.collapses).toBe(1);
  });

  it('separates clutch from blowout matches', () => {
    const result = situationalAnalysis(matches);
    expect(result.clutch.stats.matches).toBe(2);
    expect(result.clutch.stats.winRate).toBe(50);
    expect(result.blowout.stats.matches).toBe(1);
    expect(result.blowout.thresholdMargin).toBe(11);
  });

  it('aggregates matches that went to a decider', () => {
    const result = situationalAnalysis(matches);
    expect(result.deciders.matches).toBe(2);
    expect(result.deciders.winRate).toBe(50);
  });

  it('splits results by who took the first game', () => {
    const result = situationalAnalysis(matches);
    expect(result.firstGames.won).toBe(3);
    expect(result.firstGames.lost).toBe(2);
    expect(result.afterWinningFirstGame).toBeCloseTo(66.7, 1);
    expect(result.afterLosingFirstGame).toBe(50);
  });
});

describe('fatigueAnalysis', () => {
  it('withholds an observation below the session threshold', () => {
    const result = fatigueAnalysis([
      makeMatch({ sessionId: 's1', orderInSession: 1 }),
      makeMatch({ sessionId: 's1', orderInSession: 2 }),
    ]);
    expect(result.observation).toBeNull();
    expect(result.earlyVsLateWinRateDelta).toBeNull();
  });

  it('reports a decline when later matches are lost more often', () => {
    const matches = [];
    for (let session = 1; session <= 6; session += 1) {
      matches.push(
        makeMatch({ sessionId: `s${session}`, orderInSession: 1, games: games('21-10', '21-10') }),
        makeMatch({ sessionId: `s${session}`, orderInSession: 2, games: games('21-15', '21-15') }),
        makeMatch({ sessionId: `s${session}`, orderInSession: 3, games: games('10-21', '10-21') }),
      );
    }
    const result = fatigueAnalysis(matches);
    expect(result.buckets).toHaveLength(3);
    expect(result.earlyVsLateWinRateDelta).toBeLessThanOrEqual(-10);
    expect(result.observation).toMatch(/appears to decline/);
  });

  it('describes performance as stable when it does not move', () => {
    const matches = [];
    for (let session = 1; session <= 6; session += 1) {
      matches.push(
        makeMatch({ sessionId: `s${session}`, orderInSession: 1, games: games('21-15', '21-15') }),
        makeMatch({ sessionId: `s${session}`, orderInSession: 2, games: games('21-15', '21-15') }),
      );
    }
    expect(fatigueAnalysis(matches).observation).toMatch(/broadly stable/);
  });
});

describe('buildTrend', () => {
  it('buckets by calendar month in the requested time zone', () => {
    const trend = buildTrend(
      [
        makeMatch({ playedAt: new Date('2026-01-15T12:00:00Z'), games: games('21-10', '21-10') }),
        makeMatch({ playedAt: new Date('2026-01-20T12:00:00Z'), games: games('10-21', '10-21') }),
        makeMatch({ playedAt: new Date('2026-02-05T12:00:00Z'), games: games('21-10', '21-10') }),
      ],
      'MONTH',
      'UTC',
    );

    expect(trend.points).toHaveLength(2);
    expect(trend.points[0]?.label).toBe('January 2026');
    expect(trend.points[0]?.stats.winRate).toBe(50);
    expect(trend.points[1]?.stats.winRate).toBe(100);
  });

  it('places a late-evening match in the local day, not the UTC one', () => {
    // 23:30 on 31 January in Auckland is 10:30 UTC on 31 January; in UTC-11 it is still January.
    const trend = buildTrend(
      [makeMatch({ playedAt: new Date('2026-02-01T10:30:00Z') })],
      'MONTH',
      'Pacific/Auckland',
    );
    expect(trend.points[0]?.label).toBe('February 2026');

    const honolulu = buildTrend(
      [makeMatch({ playedAt: new Date('2026-02-01T05:30:00Z') })],
      'MONTH',
      'Pacific/Honolulu',
    );
    expect(honolulu.points[0]?.label).toBe('January 2026');
  });

  it('withholds a trend slope below three points', () => {
    const trend = buildTrend([makeMatch()], 'MONTH', 'UTC');
    expect(trend.winRateTrendPerPeriod).toBeNull();
  });

  it('computes a positive slope for improving months', () => {
    const trend = buildTrend(
      [
        makeMatch({ playedAt: new Date('2026-01-10T12:00:00Z'), games: games('10-21', '10-21') }),
        makeMatch({
          playedAt: new Date('2026-02-10T12:00:00Z'),
          games: games('21-10', '10-21', '21-15'),
        }),
        makeMatch({ playedAt: new Date('2026-03-10T12:00:00Z'), games: games('21-10', '21-10') }),
      ],
      'MONTH',
      'UTC',
    );
    expect(trend.points).toHaveLength(3);
    expect(trend.winRateTrendPerPeriod).toBeGreaterThan(0);
  });
});

describe('tagCorrelations', () => {
  it('reports win rate per tag against the overall rate', () => {
    const correlations = tagCorrelations([
      makeMatch({ tags: ['FATIGUE'], games: games('15-21', '15-21') }),
      makeMatch({ tags: ['FATIGUE'], games: games('15-21', '15-21') }),
      makeMatch({ tags: ['STRONG_ATTACK'], games: games('21-15', '21-15') }),
      makeMatch({ tags: [], games: games('21-15', '21-15') }),
    ]);

    const fatigue = correlations.find((entry) => entry.tag === 'FATIGUE');
    expect(fatigue?.matches).toBe(2);
    expect(fatigue?.winRate).toBe(0);
    expect(fatigue?.winRateDelta).toBe(-50);
  });

  it('omits tags that were never used', () => {
    const correlations = tagCorrelations([makeMatch({ tags: ['NERVOUS'] })]);
    expect(correlations.map((entry) => entry.tag)).toEqual(['NERVOUS']);
  });
});
