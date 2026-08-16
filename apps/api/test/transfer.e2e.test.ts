import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, registerUser, resetDatabase, type TestContext, type TestUser } from './harness';

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

const HEADER =
  'date,venue,sessionType,discipline,partner,opponent1,opponent2,game1,game2,game3,game4,game5,durationMinutes,difficulty,notes';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('import preview', () => {
  it('writes nothing and reports what would happen', async () => {
    const response = await user.agent
      .post('/api/v1/transfer/import/preview')
      .send({
        csv: csv(
          '2026-08-01,Riverside,CASUAL,SINGLES,,John Carter,,21-18,19-21,21-16,,,42,3,Found my length',
        ),
      })
      .expect(200);

    expect(response.body.totalRows).toBe(1);
    expect(response.body.readyRows).toBe(1);
    expect(response.body.rows[0].status).toBe('READY');
    expect(response.body.rows[0].result).toBe('WIN');
    expect(response.body.rows[0].newPlayers).toEqual(['John Carter']);
    expect(response.body.rows[0].newVenue).toBe('Riverside');

    // A preview must not touch the database.
    expect(await context.prisma.match.count()).toBe(0);
    expect(await context.prisma.player.count({ where: { isSelf: false } })).toBe(0);
  });

  it('reports each invalid row with its row number and reason', async () => {
    const response = await user.agent
      .post('/api/v1/transfer/import/preview')
      .send({
        csv: csv(
          'not-a-date,Riverside,CASUAL,SINGLES,,John Carter,,21-18,21-16,,,,,,',
          '2026-08-02,Riverside,CASUAL,SINGLES,,John Carter,,21-20,21-16,,,,,,',
          '2026-08-03,Riverside,CASUAL,DOUBLES,,John Carter,,21-18,21-16,,,,,,',
          '2026-08-04,Riverside,CASUAL,SINGLES,,John Carter,,not-a-score,,,,,,,',
        ),
      })
      .expect(200);

    expect(response.body.invalidRows).toBe(4);

    const codes = response.body.rows.flatMap((row: { issues: Array<{ code: string }> }) =>
      row.issues.map((issue) => issue.code),
    );
    expect(codes).toContain('INVALID_DATE');
    expect(codes).toContain('GAME_IMPOSSIBLE_SCORE');
    expect(codes).toContain('PARTNER_COUNT');
    expect(codes).toContain('INVALID_SCORE');

    // Row numbers match what the user sees in a spreadsheet (header is row 1).
    expect(response.body.rows[0].rowNumber).toBe(2);
    expect(response.body.rows[3].rowNumber).toBe(5);
  });

  it('rejects a file missing a required column', async () => {
    const response = await user.agent
      .post('/api/v1/transfer/import/preview')
      .send({ csv: 'date,venue\n2026-08-01,Riverside' })
      .expect(422);

    expect(response.body.message).toMatch(/missing required column/i);
  });

  it('flags rows that duplicate each other inside the same file', async () => {
    const row = '2026-08-01,Riverside,CASUAL,SINGLES,,John Carter,,21-18,21-16,,,,,,';
    const response = await user.agent
      .post('/api/v1/transfer/import/preview')
      .send({ csv: csv(row, row) })
      .expect(200);

    expect(response.body.readyRows).toBe(1);
    expect(response.body.duplicateRows).toBe(1);
  });
});

describe('import commit', () => {
  it('imports only the rows the user accepted', async () => {
    const body = {
      csv: csv(
        '2026-08-01,Riverside,CASUAL,SINGLES,,John Carter,,21-18,21-16,,,,42,3,First',
        '2026-08-02,Riverside,COMPETITIVE,DOUBLES,Ahmed Rahim,John Carter,Priya Nair,21-15,21-19,,,,35,4,Second',
      ),
    };

    const preview = await user.agent
      .post('/api/v1/transfer/import/preview')
      .send(body)
      .expect(200);
    expect(preview.body.readyRows).toBe(2);

    const commit = await user.agent
      .post('/api/v1/transfer/import/commit')
      .send({ ...body, acceptRows: [2] })
      .expect(201);

    expect(commit.body.importedMatches).toBe(1);
    expect(await context.prisma.match.count({ where: { userId: user.id } })).toBe(1);

    const match = await context.prisma.match.findFirstOrThrow({ where: { userId: user.id } });
    expect(match.result).toBe('WIN');
    expect(match.durationSeconds).toBe(42 * 60);
    expect(match.difficulty).toBe(3);
    expect(match.notes).toBe('First');
  });

  it('creates the players and venues the preview announced', async () => {
    const body = {
      csv: csv(
        '2026-08-02,Northgate,COMPETITIVE,DOUBLES,Ahmed Rahim,John Carter,Priya Nair,21-15,21-19,,,,,,',
      ),
    };

    const commit = await user.agent
      .post('/api/v1/transfer/import/commit')
      .send({ ...body, acceptRows: [2] })
      .expect(201);

    expect(commit.body.createdPlayers).toBe(3);
    expect(commit.body.createdVenues).toBe(1);

    const match = await context.prisma.match.findFirstOrThrow({
      where: { userId: user.id },
      include: { participants: true },
    });
    // Three named players plus the user themselves.
    expect(match.participants).toHaveLength(4);
    expect(match.participants.filter((p) => p.side === 'AWAY')).toHaveLength(2);
  });

  it('skips rows that duplicate matches already stored', async () => {
    const body = {
      csv: csv('2026-08-01,Riverside,CASUAL,SINGLES,,John Carter,,21-18,21-16,,,,,,'),
    };

    await user.agent
      .post('/api/v1/transfer/import/commit')
      .send({ ...body, acceptRows: [2] })
      .expect(201);

    const second = await user.agent
      .post('/api/v1/transfer/import/preview')
      .send(body)
      .expect(200);

    expect(second.body.duplicateRows).toBe(1);
    expect(second.body.readyRows).toBe(0);
  });

  it('updates the analytics after importing', async () => {
    const body = {
      csv: csv(
        '2026-08-01,Riverside,CASUAL,SINGLES,,John Carter,,21-18,21-16,,,,,,',
        '2026-08-02,Riverside,CASUAL,SINGLES,,John Carter,,15-21,17-21,,,,,,',
      ),
    };

    await user.agent
      .post('/api/v1/transfer/import/commit')
      .send({ ...body, acceptRows: [2, 3] })
      .expect(201);

    const overview = await user.agent
      .get('/api/v1/analytics/overview?preset=ALL_TIME&timeZone=UTC')
      .expect(200);

    expect(overview.body.stats.matches).toBe(2);
    expect(overview.body.stats.winRate).toBe(50);
    expect(await context.prisma.ratingEvent.count({ where: { userId: user.id } })).toBe(2);
  });
});

describe('export', () => {
  beforeEach(async () => {
    await user.agent
      .post('/api/v1/matches')
      .send({
        discipline: 'SINGLES',
        session: { date: '2026-08-01', venueName: 'Riverside', sessionType: 'CASUAL' },
        partners: [],
        opponents: [{ name: 'John Carter' }],
        games: [
          { myScore: 15, opponentScore: 21 },
          { myScore: 17, opponentScore: 21 },
        ],
        durationSeconds: 1800,
        difficulty: 4,
        notes: 'Struggled with the drift',
      })
      .expect(201);
  });

  it('exports matches as CSV without corrupting negative numbers', async () => {
    const response = await user.agent
      .get('/api/v1/transfer/export?dataset=matches&format=csv')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.headers['content-disposition']).toMatch(/attachment; filename=/);

    const lines = response.text.trim().split('\r\n');
    expect(lines[0]).toContain('pointDifferential');

    const differential = lines[1]?.split(',').pop();
    // A losing differential must export as -10, never as '-10.
    expect(differential).toBe('-10');
  });

  it('exports a CSV the importer accepts back', async () => {
    const exported = await user.agent
      .get('/api/v1/transfer/export?dataset=matches&format=csv')
      .expect(200);

    // A second account importing the exported file should read it cleanly.
    const other = await registerUser(context);
    const preview = await other.agent
      .post('/api/v1/transfer/import/preview')
      .send({ csv: exported.text })
      .expect(200);

    expect(preview.body.invalidRows).toBe(0);
    expect(preview.body.readyRows).toBe(1);
    expect(preview.body.rows[0].result).toBe('LOSS');
  });

  it('exports JSON', async () => {
    const response = await user.agent
      .get('/api/v1/transfer/export?dataset=matches&format=json')
      .expect(200);

    const parsed = JSON.parse(response.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].opponents).toEqual(['John Carter']);
    expect(parsed[0].games).toHaveLength(2);
  });

  it('serves an import template that the importer accepts', async () => {
    const template = await user.agent.get('/api/v1/transfer/import/template').expect(200);

    const preview = await user.agent
      .post('/api/v1/transfer/import/preview')
      .send({ csv: template.text })
      .expect(200);

    expect(preview.body.invalidRows).toBe(0);
    expect(preview.body.totalRows).toBeGreaterThan(0);
  });

  it('never exports another user’s data', async () => {
    const other = await registerUser(context);
    const response = await other.agent
      .get('/api/v1/transfer/export?dataset=matches&format=json')
      .expect(200);

    expect(JSON.parse(response.text)).toEqual([]);
  });
});
