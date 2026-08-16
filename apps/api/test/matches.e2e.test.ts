import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  recordMatch,
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
  user = await registerUser(context);
});

describe('quick match entry', () => {
  it('creates the session, venue, players and match in one request', async () => {
    const response = await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'DOUBLES',
        session: {
          date: '2026-08-15',
          venueName: 'Riverside Sports Hall',
          sessionType: 'CASUAL',
        },
        partners: [{ name: 'Ahmed Rahim' }],
        opponents: [{ name: 'John Carter' }, { name: 'Priya Nair' }],
        games: [
          { myScore: 21, opponentScore: 18 },
          { myScore: 17, opponentScore: 21 },
          { myScore: 21, opponentScore: 16 },
        ],
      })
      .expect(201);

    expect(response.body.derived.result).toBe('WIN');
    expect(response.body.derived.wentToDecider).toBe(true);
    expect(response.body.opponents.map((o: { name: string }) => o.name)).toEqual([
      'John Carter',
      'Priya Nair',
    ]);

    // Three new players plus the user's own row.
    expect(await context.prisma.player.count({ where: { userId: user.id } })).toBe(4);
    expect(await context.prisma.venue.count({ where: { userId: user.id } })).toBe(1);
    expect(await context.prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('reuses the same session for a second match on the same day and venue', async () => {
    const body = {
      discipline: 'SINGLES' as const,
      session: { date: '2026-08-15', venueName: 'Riverside', sessionType: 'CASUAL' as const },
      partners: [],
      opponents: [{ name: 'John Carter' }],
      games: [
        { myScore: 21, opponentScore: 15 },
        { myScore: 21, opponentScore: 12 },
      ],
    };

    const first = await user.agent.post('/api/v1/matches').send(body).expect(201);
    const second = await user.agent.post('/api/v1/matches').send(body).expect(201);

    expect(second.body.sessionId).toBe(first.body.sessionId);
    expect(second.body.orderInSession).toBe(2);
    expect(await context.prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('resolves an existing player by name regardless of case', async () => {
    await recordMatch(user, { opponents: [{ name: 'John Carter' }] });
    await recordMatch(user, { opponents: [{ name: 'john carter' }] });

    const players = await context.prisma.player.findMany({
      where: { userId: user.id, isSelf: false },
    });
    expect(players).toHaveLength(1);
    expect(players[0]?.name).toBe('John Carter');
  });

  it('rejects the same player on both sides', async () => {
    const response = await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'DOUBLES',
        session: { date: '2026-08-15', sessionType: 'CASUAL' },
        partners: [{ name: 'John Carter' }],
        opponents: [{ name: 'John Carter' }, { name: 'Priya Nair' }],
        games: [
          { myScore: 21, opponentScore: 15 },
          { myScore: 21, opponentScore: 12 },
        ],
      })
      .expect(422);

    expect(response.body.message).toMatch(/both sides/i);
    // Nothing may survive a rejected request.
    expect(await context.prisma.match.count()).toBe(0);
    expect(await context.prisma.player.count({ where: { isSelf: false } })).toBe(0);
  });
});

describe('score validation', () => {
  const invalidCases: Array<[string, Array<{ myScore: number; opponentScore: number }>]> = [
    ['a one-point win at the target', [{ myScore: 21, opponentScore: 20 }]],
    ['a deuce won by more than two', [{ myScore: 23, opponentScore: 19 }]],
    ['an unfinished game', [{ myScore: 19, opponentScore: 17 }]],
    ['a tied game', [{ myScore: 21, opponentScore: 21 }]],
    [
      'a game after the match was decided',
      [
        { myScore: 21, opponentScore: 15 },
        { myScore: 21, opponentScore: 17 },
        { myScore: 21, opponentScore: 10 },
      ],
    ],
  ];

  it.each(invalidCases)('rejects %s', async (_label, games) => {
    await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'SINGLES',
        session: { date: '2026-08-15', sessionType: 'CASUAL' },
        partners: [],
        opponents: [{ name: 'John Carter' }],
        games,
      })
      .expect(422);

    expect(await context.prisma.match.count()).toBe(0);
  });

  it('accepts legitimate deuce and cap scores', async () => {
    const response = await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'SINGLES',
        session: { date: '2026-08-15', sessionType: 'CASUAL' },
        partners: [],
        opponents: [{ name: 'John Carter' }],
        games: [
          { myScore: 22, opponentScore: 20 },
          { myScore: 29, opponentScore: 30 },
          { myScore: 30, opponentScore: 29 },
        ],
      })
      .expect(201);

    expect(response.body.derived.result).toBe('WIN');
  });

  it('honours a custom scoring format', async () => {
    const response = await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'SINGLES',
        session: { date: '2026-08-15', sessionType: 'CASUAL' },
        scoring: { pointsToWin: 15, winBy: 2, maxPoints: 21, bestOf: 1 },
        partners: [],
        opponents: [{ name: 'John Carter' }],
        games: [{ myScore: 15, opponentScore: 11 }],
      })
      .expect(201);

    expect(response.body.scoring.pointsToWin).toBe(15);
    expect(response.body.derived.result).toBe('WIN');
  });

  it('rejects a 21-point score under a 15-point format', async () => {
    await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'SINGLES',
        session: { date: '2026-08-15', sessionType: 'CASUAL' },
        scoring: { pointsToWin: 15, winBy: 2, maxPoints: 21, bestOf: 1 },
        partners: [],
        opponents: [{ name: 'John Carter' }],
        games: [{ myScore: 21, opponentScore: 11 }],
      })
      .expect(422);
  });
});

describe('derived statistics', () => {
  it('computes results from the games, not from client input', async () => {
    const response = await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'SINGLES',
        session: { date: '2026-08-15', sessionType: 'CASUAL' },
        partners: [],
        opponents: [{ name: 'John Carter' }],
        games: [
          { myScore: 18, opponentScore: 21 },
          { myScore: 21, opponentScore: 15 },
          { myScore: 21, opponentScore: 19 },
        ],
        // A client claiming a loss must not be believed over the scoreline.
        result: 'LOSS',
        pointDifferential: -999,
      })
      .expect(201);

    expect(response.body.derived.result).toBe('WIN');
    expect(response.body.derived.isComeback).toBe(true);
    expect(response.body.derived.pointDifferential).toBe(60 - 55);

    const stored = await context.prisma.match.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.result).toBe('WIN');
    expect(stored.pointDifferential).toBe(5);
  });

  it('keeps the stored derived columns in step with an edit', async () => {
    const created = await recordMatch(user);
    expect(created.derived.result).toBe('WIN');

    await user.agent
      .patch(`/api/v1/matches/${created.id}`)
      .send({
        discipline: 'SINGLES',
        partners: [],
        opponents: [{ name: 'Test Opponent' }],
        games: [
          { myScore: 15, opponentScore: 21 },
          { myScore: 12, opponentScore: 21 },
        ],
      })
      .expect(200);

    const stored = await context.prisma.match.findFirstOrThrow({ where: { id: created.id } });
    expect(stored.result).toBe('LOSS');
    expect(stored.gamesWon).toBe(0);
    expect(stored.pointDifferential).toBe(27 - 42);
    expect(await context.prisma.game.count({ where: { matchId: created.id } })).toBe(2);
  });
});

describe('deletion', () => {
  it('renumbers the remaining matches so positions stay contiguous', async () => {
    const body = {
      discipline: 'SINGLES' as const,
      session: { date: '2026-08-15', sessionType: 'CASUAL' as const },
      partners: [],
      opponents: [{ name: 'John Carter' }],
      games: [
        { myScore: 21, opponentScore: 15 },
        { myScore: 21, opponentScore: 12 },
      ],
    };

    const first = await user.agent.post('/api/v1/matches').send(body).expect(201);
    const second = await user.agent.post('/api/v1/matches').send(body).expect(201);
    const third = await user.agent.post('/api/v1/matches').send(body).expect(201);

    await user.agent.delete(`/api/v1/matches/${second.body.id}`).expect(204);

    const remaining = await context.prisma.match.findMany({
      where: { sessionId: first.body.sessionId },
      orderBy: { orderInSession: 'asc' },
      select: { id: true, orderInSession: true },
    });

    expect(remaining.map((match) => match.orderInSession)).toEqual([1, 2]);
    expect(remaining.map((match) => match.id)).toEqual([first.body.id, third.body.id]);
  });

  it('removes the games along with the match', async () => {
    const match = await recordMatch(user);
    await user.agent.delete(`/api/v1/matches/${match.id}`).expect(204);
    expect(await context.prisma.game.count({ where: { matchId: match.id } })).toBe(0);
  });
});

describe('ownership isolation', () => {
  it('hides another user’s matches, players and venues', async () => {
    const other = await registerUser(context);
    const theirMatch = await recordMatch(other, {
      session: { date: '2026-08-15', venueName: 'Their Hall', sessionType: 'CASUAL' },
      opponents: [{ name: 'Their Opponent' }],
    });

    // Not listed.
    const list = await user.agent.get('/api/v1/matches').expect(200);
    expect(list.body.items).toHaveLength(0);

    // Not fetchable by id, and reported as missing rather than forbidden so the
    // response does not confirm that the id exists.
    await user.agent.get(`/api/v1/matches/${theirMatch.id}`).expect(404);
    await user.agent.delete(`/api/v1/matches/${theirMatch.id}`).expect(404);

    const players = await user.agent.get('/api/v1/players').expect(200);
    expect(players.body.items).toHaveLength(0);

    const venues = await user.agent.get('/api/v1/venues').expect(200);
    expect(venues.body.items).toHaveLength(0);
  });

  it('refuses to attach a match to another user’s session', async () => {
    const other = await registerUser(context);
    const theirMatch = await recordMatch(other);
    const theirSession = theirMatch.sessionId as unknown as string;

    await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'SINGLES',
        sessionId: theirSession,
        partners: [],
        opponents: [{ name: 'John Carter' }],
        games: [
          { myScore: 21, opponentScore: 15 },
          { myScore: 21, opponentScore: 12 },
        ],
      })
      .expect(404);
  });

  it('refuses to reference another user’s player by id', async () => {
    const other = await registerUser(context);
    await recordMatch(other, { opponents: [{ name: 'Their Opponent' }] });
    const theirPlayer = await context.prisma.player.findFirstOrThrow({
      where: { userId: other.id, isSelf: false },
    });

    await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'SINGLES',
        session: { date: '2026-08-15', sessionType: 'CASUAL' },
        partners: [],
        opponents: [{ playerId: theirPlayer.id }],
        games: [
          { myScore: 21, opponentScore: 15 },
          { myScore: 21, opponentScore: 12 },
        ],
      })
      .expect(404);
  });
});

describe('listing and filtering', () => {
  beforeEach(async () => {
    await recordMatch(user, {
      discipline: 'SINGLES',
      opponents: [{ name: 'John Carter' }],
      games: [
        { myScore: 21, opponentScore: 5 },
        { myScore: 21, opponentScore: 8 },
      ],
    });
    await recordMatch(user, {
      discipline: 'DOUBLES',
      partners: [{ name: 'Ahmed Rahim' }],
      opponents: [{ name: 'John Carter' }, { name: 'Priya Nair' }],
      games: [
        { myScore: 15, opponentScore: 21 },
        { myScore: 19, opponentScore: 21 },
      ],
    });
  });

  it('filters by result', async () => {
    const wins = await user.agent.get('/api/v1/matches?result=WIN').expect(200);
    expect(wins.body.items).toHaveLength(1);
    expect(wins.body.items[0].derived.result).toBe('WIN');
  });

  it('filters by discipline', async () => {
    const doubles = await user.agent.get('/api/v1/matches?discipline=DOUBLES').expect(200);
    expect(doubles.body.items).toHaveLength(1);
  });

  it('filters by opponent', async () => {
    const priya = await context.prisma.player.findFirstOrThrow({
      where: { userId: user.id, name: 'Priya Nair' },
    });
    const response = await user.agent.get(`/api/v1/matches?opponentId=${priya.id}`).expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].discipline).toBe('DOUBLES');
  });

  it('filters by partner without matching them as an opponent', async () => {
    const ahmed = await context.prisma.player.findFirstOrThrow({
      where: { userId: user.id, name: 'Ahmed Rahim' },
    });
    const asPartner = await user.agent.get(`/api/v1/matches?partnerId=${ahmed.id}`).expect(200);
    expect(asPartner.body.items).toHaveLength(1);

    const asOpponent = await user.agent.get(`/api/v1/matches?opponentId=${ahmed.id}`).expect(200);
    expect(asOpponent.body.items).toHaveLength(0);
  });

  it('sorts by biggest win', async () => {
    const response = await user.agent.get('/api/v1/matches?sort=BIGGEST_WIN').expect(200);
    expect(response.body.items[0].derived.result).toBe('WIN');
  });

  it('paginates', async () => {
    const response = await user.agent.get('/api/v1/matches?page=1&pageSize=1').expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.meta).toMatchObject({ totalItems: 2, totalPages: 2, hasNextPage: true });
  });
});
