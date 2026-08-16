import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  registerUser,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './harness';

let context: TestContext;
let user: TestUser;

beforeAll(async () => {
  context = await createTestApp();
});

afterAll(async () => {
  await context.app.close();
});

beforeEach(async () => {
  await resetDatabase(context.prisma);
  user = await registerUser(context, { timeZone: 'UTC' });
});

const ALL_TIME = 'preset=ALL_TIME&timeZone=UTC';

/** Records a match on a specific date, so trend and range tests have real timestamps. */
async function play(
  who: TestUser,
  options: {
    date: string;
    games: Array<[number, number]>;
    discipline?: 'SINGLES' | 'DOUBLES' | 'MIXED_DOUBLES';
    opponents?: string[];
    partner?: string;
    venue?: string;
    playedAt?: string;
  },
): Promise<Record<string, unknown>> {
  const discipline = options.discipline ?? 'SINGLES';
  const opponents = options.opponents ?? ['John Carter'];

  const response = await who.agent
    .post('/api/v1/matches')
    .send({
      discipline,
      session: {
        date: options.date,
        sessionType: 'CASUAL',
        ...(options.venue ? { venueName: options.venue } : {}),
      },
      ...(options.playedAt ? { playedAt: options.playedAt } : {}),
      partners: options.partner ? [{ name: options.partner }] : [],
      opponents: opponents.map((name) => ({ name })),
      games: options.games.map(([myScore, opponentScore]) => ({ myScore, opponentScore })),
    })
    .expect(201);

  return response.body;
}

describe('overview', () => {
  it('reports unknown rather than zero for an account with no matches', async () => {
    const response = await user.agent.get(`/api/v1/analytics/overview?${ALL_TIME}`).expect(200);

    expect(response.body.stats.matches).toBe(0);
    // A player with no matches has an unknown win rate, not a 0% one.
    expect(response.body.stats.winRate).toBeNull();
    expect(response.body.stats.gameWinRate).toBeNull();
    expect(response.body.streaks.current).toBe(0);
  });

  it('computes headline statistics from recorded matches', async () => {
    await play(user, {
      date: '2026-03-01',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
    await play(user, {
      date: '2026-03-08',
      games: [
        [15, 21],
        [17, 21],
      ],
    });
    await play(user, {
      date: '2026-03-15',
      games: [
        [21, 18],
        [18, 21],
        [21, 19],
      ],
    });

    const response = await user.agent.get(`/api/v1/analytics/overview?${ALL_TIME}`).expect(200);
    const stats = response.body.stats;

    expect(stats.matches).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(66.7, 1);
    expect(stats.gamesWon).toBe(4);
    expect(stats.gamesLost).toBe(3);
    expect(stats.pointsScored).toBe(42 + 32 + 60);
    expect(stats.pointsConceded).toBe(32 + 42 + 58);
    expect(stats.pointDifferential).toBe(2);
    expect(response.body.sessions).toBe(3);
    expect(response.body.distinctOpponents).toBe(1);
  });

  it('tracks the current streak', async () => {
    await play(user, {
      date: '2026-03-01',
      games: [
        [15, 21],
        [17, 21],
      ],
    });
    await play(user, {
      date: '2026-03-02',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
    await play(user, {
      date: '2026-03-03',
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const response = await user.agent.get(`/api/v1/analytics/overview?${ALL_TIME}`).expect(200);
    expect(response.body.streaks.currentWinStreak).toBe(2);
    expect(response.body.streaks.current).toBe(2);
  });

  it('excludes another user’s matches entirely', async () => {
    const other = await registerUser(context);
    await play(other, {
      date: '2026-03-01',
      games: [
        [21, 5],
        [21, 5],
      ],
    });
    await play(user, {
      date: '2026-03-01',
      games: [
        [15, 21],
        [17, 21],
      ],
    });

    const response = await user.agent.get(`/api/v1/analytics/overview?${ALL_TIME}`).expect(200);
    expect(response.body.stats.matches).toBe(1);
    expect(response.body.stats.wins).toBe(0);
  });
});

describe('date filtering', () => {
  beforeEach(async () => {
    await play(user, {
      date: '2026-01-10',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
    await play(user, {
      date: '2026-02-10',
      games: [
        [15, 21],
        [17, 21],
      ],
    });
    await play(user, {
      date: '2026-03-10',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
  });

  it('honours a custom range', async () => {
    const response = await user.agent
      .get('/api/v1/analytics/overview?preset=CUSTOM&from=2026-02-01&to=2026-02-28&timeZone=UTC')
      .expect(200);

    expect(response.body.stats.matches).toBe(1);
    expect(response.body.stats.losses).toBe(1);
  });

  it('rejects a custom range without bounds', async () => {
    await user.agent.get('/api/v1/analytics/overview?preset=CUSTOM&timeZone=UTC').expect(422);
  });

  it('rejects a reversed range', async () => {
    await user.agent
      .get('/api/v1/analytics/overview?preset=CUSTOM&from=2026-03-01&to=2026-01-01&timeZone=UTC')
      .expect(422);
  });

  it('rejects an unknown time zone', async () => {
    const response = await user.agent
      .get('/api/v1/analytics/overview?preset=ALL_TIME&timeZone=Mars/Olympus_Mons')
      .expect(422);
    expect(response.body.message).toMatch(/time zone/i);
  });
});

describe('trend', () => {
  it('buckets by month and omits months with no play', async () => {
    await play(user, {
      date: '2026-01-10',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
    await play(user, {
      date: '2026-01-20',
      games: [
        [15, 21],
        [17, 21],
      ],
    });
    await play(user, {
      date: '2026-03-10',
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const response = await user.agent
      .get(`/api/v1/analytics/trend?${ALL_TIME}&granularity=MONTH`)
      .expect(200);

    // February had no matches and must not appear as a 0% month.
    expect(response.body.points).toHaveLength(2);
    expect(response.body.points[0].label).toBe('January 2026');
    expect(response.body.points[0].stats.winRate).toBe(50);
    expect(response.body.points[1].label).toBe('March 2026');
    expect(response.body.points[1].stats.winRate).toBe(100);
  });
});

describe('breakdowns', () => {
  beforeEach(async () => {
    await play(user, {
      date: '2026-03-01',
      discipline: 'SINGLES',
      opponents: ['John Carter'],
      games: [
        [21, 15],
        [21, 17],
      ],
      venue: 'Riverside',
    });
    await play(user, {
      date: '2026-03-02',
      discipline: 'SINGLES',
      opponents: ['John Carter'],
      games: [
        [15, 21],
        [17, 21],
      ],
      venue: 'Riverside',
    });
    await play(user, {
      date: '2026-03-03',
      discipline: 'DOUBLES',
      partner: 'Ahmed Rahim',
      opponents: ['John Carter', 'Priya Nair'],
      games: [
        [21, 15],
        [21, 17],
      ],
      venue: 'Northgate',
    });
  });

  it('produces a head-to-head record per opponent', async () => {
    const response = await user.agent.get(`/api/v1/analytics/opponents?${ALL_TIME}`).expect(200);

    const john = response.body.find(
      (entry: { subject: { name: string } }) => entry.subject.name === 'John Carter',
    );
    expect(john.stats.matches).toBe(3);
    expect(john.stats.wins).toBe(2);
    expect(john.stats.winRate).toBeCloseTo(66.7, 1);

    const priya = response.body.find(
      (entry: { subject: { name: string } }) => entry.subject.name === 'Priya Nair',
    );
    expect(priya.stats.matches).toBe(1);
  });

  it('counts a partner as a partner, never as an opponent', async () => {
    const partners = await user.agent.get(`/api/v1/analytics/partners?${ALL_TIME}`).expect(200);
    expect(partners.body).toHaveLength(1);
    expect(partners.body[0].subject.name).toBe('Ahmed Rahim');
    expect(partners.body[0].stats.matches).toBe(1);

    const opponents = await user.agent.get(`/api/v1/analytics/opponents?${ALL_TIME}`).expect(200);
    expect(
      opponents.body.some(
        (entry: { subject: { name: string } }) => entry.subject.name === 'Ahmed Rahim',
      ),
    ).toBe(false);
  });

  it('splits venue performance by discipline', async () => {
    const response = await user.agent.get(`/api/v1/analytics/venues?${ALL_TIME}`).expect(200);

    const riverside = response.body.find(
      (entry: { subject: { name: string } }) => entry.subject.name === 'Riverside',
    );
    expect(riverside.stats.matches).toBe(2);
    expect(riverside.singles.matches).toBe(2);
    expect(riverside.doubles.matches).toBe(0);
    expect(riverside.doubles.winRate).toBeNull();
  });

  it('returns every discipline, including ones never played', async () => {
    const response = await user.agent.get(`/api/v1/analytics/disciplines?${ALL_TIME}`).expect(200);

    expect(response.body).toHaveLength(3);
    const mixed = response.body.find(
      (entry: { subject: { discipline: string } }) => entry.subject.discipline === 'MIXED_DOUBLES',
    );
    expect(mixed.stats.matches).toBe(0);
    expect(mixed.stats.winRate).toBeNull();
  });
});

describe('situational analysis', () => {
  it('identifies comebacks, collapses and deciders', async () => {
    await play(user, {
      date: '2026-03-01',
      games: [
        [18, 21],
        [21, 15],
        [21, 19],
      ],
    });
    await play(user, {
      date: '2026-03-02',
      games: [
        [21, 18],
        [15, 21],
        [19, 21],
      ],
    });
    await play(user, {
      date: '2026-03-03',
      games: [
        [21, 5],
        [21, 8],
      ],
    });

    const response = await user.agent.get(`/api/v1/analytics/situational?${ALL_TIME}`).expect(200);

    expect(response.body.comebacks).toBe(1);
    expect(response.body.collapses).toBe(1);
    expect(response.body.deciders.matches).toBe(2);
    expect(response.body.blowout.stats.matches).toBe(1);
  });

  it('withholds a consistency score below the sample threshold', async () => {
    await play(user, {
      date: '2026-03-01',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
    const response = await user.agent.get(`/api/v1/analytics/situational?${ALL_TIME}`).expect(200);

    expect(response.body.consistency.score).toBeNull();
    expect(response.body.consistency.method).toMatch(/consistency-v1/);
  });
});

describe('insights', () => {
  it('returns nothing for an empty account rather than inventing findings', async () => {
    const response = await user.agent.get(`/api/v1/analytics/insights?${ALL_TIME}`).expect(200);
    expect(response.body).toEqual([]);
  });

  it('attaches evidence and a claim strength to every insight', async () => {
    for (let day = 1; day <= 12; day += 1) {
      await play(user, {
        date: `2026-03-${String(day).padStart(2, '0')}`,
        games:
          day % 3 === 0
            ? [
                [15, 21],
                [17, 21],
              ]
            : [
                [21, 15],
                [21, 17],
              ],
      });
    }

    const response = await user.agent.get(`/api/v1/analytics/insights?${ALL_TIME}`).expect(200);
    expect(response.body.length).toBeGreaterThan(0);

    for (const insight of response.body) {
      expect(['OBSERVATION', 'INTERPRETATION', 'RECOMMENDATION']).toContain(insight.kind);
      expect(Object.keys(insight.evidence).length).toBeGreaterThan(0);
      expect(insight.sampleSize).toBeGreaterThan(0);
    }
  });
});

describe('rating', () => {
  it('starts every account at the configured rating', async () => {
    const response = await user.agent.get('/api/v1/analytics/rating').expect(200);
    expect(response.body.overall).toBe(1200);
    expect(response.body.disclaimer).toMatch(/not an official badminton ranking/i);
  });

  it('moves the rating up on a win and records the history', async () => {
    await play(user, {
      date: '2026-03-01',
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const rating = await user.agent.get('/api/v1/analytics/rating').expect(200);
    expect(rating.body.overall).toBeGreaterThan(1200);

    const history = await user.agent.get('/api/v1/analytics/rating/history').expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].delta).toBeGreaterThan(0);
  });

  it('recomputes the rating when a match is deleted', async () => {
    const match = await play(user, {
      date: '2026-03-01',
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const afterWin = await user.agent.get('/api/v1/analytics/rating').expect(200);
    expect(afterWin.body.overall).toBeGreaterThan(1200);

    await user.agent.delete(`/api/v1/matches/${match.id as string}`).expect(204);

    // Ratings are replayed from raw matches, so deleting the only match restores the
    // starting rating exactly rather than leaving a stale value behind.
    const afterDelete = await user.agent.get('/api/v1/analytics/rating').expect(200);
    expect(afterDelete.body.overall).toBe(1200);
    expect(await context.prisma.ratingEvent.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('records and heatmap', () => {
  it('derives personal records from raw matches', async () => {
    await play(user, {
      date: '2026-03-01',
      games: [
        [30, 29],
        [21, 19],
      ],
    });
    await play(user, {
      date: '2026-03-02',
      games: [
        [21, 4],
        [21, 6],
      ],
    });

    const response = await user.agent.get(`/api/v1/analytics/records?${ALL_TIME}`).expect(200);
    const byCode = Object.fromEntries(
      response.body.map((record: { code: string; value: string }) => [record.code, record.value]),
    );

    expect(byCode.HIGHEST_SCORING_GAME).toBe('30-29');
    expect(byCode.LARGEST_WINNING_MARGIN).toBe('21-4');
    expect(byCode.CLOSEST_WIN).toBe('30-29');
  });

  it('counts activity per day', async () => {
    await play(user, {
      date: '2026-03-01',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
    await play(user, {
      date: '2026-03-01',
      games: [
        [15, 21],
        [17, 21],
      ],
    });
    await play(user, {
      date: '2026-03-05',
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const response = await user.agent.get(`/api/v1/analytics/heatmap?${ALL_TIME}`).expect(200);
    const days = response.body.days as Array<{ date: string; matches: number; sessions: number }>;

    const first = days.find((day) => day.date === '2026-03-01');
    expect(first?.matches).toBe(2);
    expect(first?.sessions).toBe(1);
    expect(days).toHaveLength(2);
  });
});

describe('goals', () => {
  it('computes progress from matches instead of storing it', async () => {
    await user.agent
      .post('/api/v1/goals')
      .send({
        title: 'Play 4 matches',
        metric: 'MATCHES_PLAYED',
        targetValue: 4,
        startsOn: '2026-01-01',
      })
      .expect(201);

    await play(user, {
      date: '2026-03-01',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
    await play(user, {
      date: '2026-03-02',
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const halfway = await user.agent.get('/api/v1/goals').expect(200);
    expect(halfway.body.items[0].currentValue).toBe(2);
    expect(halfway.body.items[0].percentComplete).toBe(50);
    expect(halfway.body.items[0].status).toBe('ACTIVE');

    await play(user, {
      date: '2026-03-03',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
    await play(user, {
      date: '2026-03-04',
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const done = await user.agent.get('/api/v1/goals').expect(200);
    expect(done.body.items[0].currentValue).toBe(4);
    expect(done.body.items[0].status).toBe('ACHIEVED');
  });

  it('scopes a goal to its discipline', async () => {
    await user.agent
      .post('/api/v1/goals')
      .send({
        title: 'Play 2 singles matches',
        metric: 'MATCHES_PLAYED',
        targetValue: 2,
        discipline: 'SINGLES',
        startsOn: '2026-01-01',
      })
      .expect(201);

    await play(user, {
      date: '2026-03-01',
      discipline: 'SINGLES',
      games: [
        [21, 15],
        [21, 17],
      ],
    });
    await play(user, {
      date: '2026-03-02',
      discipline: 'DOUBLES',
      partner: 'Ahmed Rahim',
      opponents: ['John Carter', 'Priya Nair'],
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const response = await user.agent.get('/api/v1/goals').expect(200);
    expect(response.body.items[0].currentValue).toBe(1);
  });
});

describe('achievements', () => {
  it('unlocks automatically and never twice', async () => {
    await play(user, {
      date: '2026-03-01',
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const list = await user.agent.get('/api/v1/achievements').expect(200);
    const first = list.body.find((entry: { code: string }) => entry.code === 'FIRST_MATCH');
    expect(first.unlocked).toBe(true);

    const firstWin = list.body.find((entry: { code: string }) => entry.code === 'WINS_1');
    expect(firstWin.unlocked).toBe(true);

    // Re-evaluating must be idempotent.
    await user.agent.post('/api/v1/achievements/evaluate').expect(201);
    const count = await context.prisma.userAchievement.count({
      where: { userId: user.id, achievementCode: 'FIRST_MATCH' },
    });
    expect(count).toBe(1);
  });

  it('reports progress towards locked achievements', async () => {
    await play(user, {
      date: '2026-03-01',
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const list = await user.agent.get('/api/v1/achievements').expect(200);
    const tenMatches = list.body.find((entry: { code: string }) => entry.code === 'MATCHES_10');
    expect(tenMatches.unlocked).toBe(false);
    expect(tenMatches.progress).toBe(1);
    expect(tenMatches.percentComplete).toBe(10);
  });
});

describe('reports and search', () => {
  it('generates a report consistent with the overview it summarises', async () => {
    for (let day = 1; day <= 6; day += 1) {
      await play(user, {
        date: `2026-03-0${day}`,
        games:
          day % 2 === 0
            ? [
                [15, 21],
                [17, 21],
              ]
            : [
                [21, 15],
                [21, 17],
              ],
      });
    }

    const [report, overview] = await Promise.all([
      user.agent.get(`/api/v1/reports/performance?${ALL_TIME}`).expect(200),
      user.agent.get(`/api/v1/analytics/overview?${ALL_TIME}`).expect(200),
    ]);

    expect(report.body.stats).toEqual(overview.body.stats);
    expect(report.body.period.label).toBe('All time');
    expect(Array.isArray(report.body.insights)).toBe(true);
  });

  it('searches across players and matches', async () => {
    await play(user, {
      date: '2026-03-01',
      opponents: ['John Carter'],
      games: [
        [21, 15],
        [21, 17],
      ],
    });

    const response = await user.agent.get('/api/v1/analytics/search?q=Carter').expect(200);
    expect(response.body.players).toHaveLength(1);
    expect(response.body.players[0].name).toBe('John Carter');
  });

  it('returns nothing for a search shorter than two characters', async () => {
    const response = await user.agent.get('/api/v1/analytics/search?q=a').expect(200);
    expect(response.body).toEqual({ players: [], venues: [], sessions: [], matches: [] });
  });
});
