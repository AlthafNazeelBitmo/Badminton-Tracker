import type { SQLiteDatabase } from 'expo-sqlite';
import { createTestDatabase } from '../db/testing';
import { listMatches, listPlayers } from '../db/cache';
import { countPending, listAll } from '../sync/outbox';
import { InvalidMatchError, recordMatch, type RecordMatchInput } from './matches';

jest.mock('../db/database', () => ({
  getDatabase: jest.fn(),
  migrate: jest.requireActual('../db/database').migrate,
}));

import { getDatabase } from '../db/database';

const mockGetDatabase = getDatabase as jest.MockedFunction<typeof getDatabase>;

/**
 * Recording a match is the app's reason to exist, and it has to work with no signal at
 * all. What these tests hold to is that the local write and the queued request are
 * inseparable: a match that appears saved but was never queued would never reach the
 * server, and nothing would ever tell the user.
 */

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  mockGetDatabase.mockResolvedValue(db);
});

afterEach(async () => {
  await db.closeAsync();
});

const straightGamesWin: RecordMatchInput = {
  discipline: 'SINGLES',
  session: { date: '2026-08-18', sessionType: 'CASUAL' },
  partners: [],
  opponents: [{ name: 'Priya' }],
  games: [
    { myScore: 21, opponentScore: 15 },
    { myScore: 21, opponentScore: 17 },
  ],
};

describe('recording offline', () => {
  it('saves the match locally and queues it, with no network involved', async () => {
    const { match } = await recordMatch(straightGamesWin, db);

    // Visible in the history immediately — the whole point of writing locally first.
    const [stored] = await listMatches({}, db);
    expect(stored?.id).toBe(match.id);
    expect(stored?.pendingLocal).toBe(true);

    expect(await countPending(db)).toBe(1);
  });

  it('derives the result on the device so the card is complete before syncing', async () => {
    const { match } = await recordMatch(straightGamesWin, db);

    // Computed by the same shared function the server uses, so the phone cannot disagree
    // with the website about who won.
    expect(match.derived.result).toBe('WIN');
    expect(match.derived.gamesWon).toBe(2);
    expect(match.derived.pointsScored).toBe(42);
  });

  it('creates a brand-new opponent without waiting for the server to issue an id', async () => {
    const { match } = await recordMatch(straightGamesWin, db);

    const players = await listPlayers(undefined, db);
    expect(players.map((player) => player.name)).toContain('Priya');
    expect(players[0]?.pendingLocal).toBe(true);

    // The match references that id straight away; the server adopts it rather than
    // assigning its own, so nothing has to be renumbered when the queue drains.
    expect(match.opponentIds[0]).toBe(players[0]?.id);
    expect(match.opponentNames).toEqual(['Priya']);
  });

  it('reuses an existing player rather than creating a duplicate', async () => {
    const first = await recordMatch(straightGamesWin, db);
    const opponentId = first.match.opponentIds[0]!;

    await recordMatch({ ...straightGamesWin, opponents: [{ id: opponentId }] }, db);

    // The same person recorded twice must stay one player, or every statistic about them
    // is split across two records.
    expect(await listPlayers(undefined, db)).toHaveLength(1);
  });

  it('sends only the id for an existing player, and id plus name for a new one', async () => {
    const first = await recordMatch(straightGamesWin, db);
    const opponentId = first.match.opponentIds[0]!;
    await recordMatch({ ...straightGamesWin, opponents: [{ id: opponentId }] }, db);

    const entries = await listAll(db);
    const newPlayerBody = entries[0]?.body as { opponents: Array<Record<string, unknown>> };
    const existingBody = entries[1]?.body as { opponents: Array<Record<string, unknown>> };

    expect(newPlayerBody.opponents[0]).toEqual({ name: 'Priya', id: expect.any(String) });
    // Sending a name for a known player invites the server to match on it and create a
    // second record for someone whose name was typed slightly differently.
    expect(existingBody.opponents[0]).toEqual({ playerId: opponentId });
  });

  it('queues one request per match, carrying the match id it already assigned', async () => {
    const { match, outboxEntryId } = await recordMatch(straightGamesWin, db);

    const entries = await listAll(db);
    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    expect(entry.id).toBe(outboxEntryId);
    expect(entry.kind).toBe('CREATE_MATCH');
    expect(entry.method).toBe('POST');
    expect(entry.endpoint).toBe('/matches');
    expect((entry.body as { id: string }).id).toBe(match.id);
  });
});

describe('validation', () => {
  it('rejects an impossible score before it is ever queued', async () => {
    await expect(
      recordMatch({ ...straightGamesWin, games: [{ myScore: 21, opponentScore: 3 }] }, db),
    ).rejects.toBeInstanceOf(InvalidMatchError);

    // Queueing it would mean the rejection surfaces minutes later, when the user is no
    // longer at the court and cannot remember the real score.
    expect(await countPending(db)).toBe(0);
    expect(await listMatches({}, db)).toHaveLength(0);
  });

  it('rejects a match that no side has won', async () => {
    await expect(
      recordMatch(
        {
          ...straightGamesWin,
          games: [
            { myScore: 21, opponentScore: 15 },
            { myScore: 18, opponentScore: 21 },
          ],
        },
        db,
      ),
    ).rejects.toBeInstanceOf(InvalidMatchError);
  });

  it('accepts a deuce and a comeback, which are ordinary badminton', async () => {
    const { match } = await recordMatch(
      {
        ...straightGamesWin,
        games: [
          { myScore: 19, opponentScore: 21 },
          { myScore: 24, opponentScore: 22 },
          { myScore: 21, opponentScore: 19 },
        ],
      },
      db,
    );

    expect(match.derived.result).toBe('WIN');
    expect(match.derived.isComeback).toBe(true);
  });

  it('refuses a participant with neither an id nor a name', async () => {
    await expect(recordMatch({ ...straightGamesWin, opponents: [{}] }, db)).rejects.toBeInstanceOf(
      InvalidMatchError,
    );
  });

  it('honours a non-default scoring format', async () => {
    // Every match stores the rules it was played under, so a 15-point social game is not
    // judged against the user's current default years later.
    const { match } = await recordMatch(
      {
        ...straightGamesWin,
        scoring: { pointsToWin: 15, winBy: 2, maxPoints: 21, bestOf: 3 },
        games: [
          { myScore: 15, opponentScore: 12 },
          { myScore: 15, opponentScore: 9 },
        ],
      },
      db,
    );

    expect(match.scoring.pointsToWin).toBe(15);
    expect(match.derived.result).toBe('WIN');
  });
});

describe('atomicity', () => {
  it('leaves nothing behind when the queue write fails', async () => {
    // Force the outbox insert to fail after the match and player rows are written. If
    // these were not one transaction, the match would sit in the cache looking saved and
    // would never be sent anywhere.
    await db.execAsync('DROP TABLE outbox');

    await expect(recordMatch(straightGamesWin, db)).rejects.toThrow();

    expect(await listMatches({}, db)).toHaveLength(0);
    expect(await listPlayers(undefined, db)).toHaveLength(0);
  });
});

describe('doubles', () => {
  it('records a partner alongside two opponents', async () => {
    const { match } = await recordMatch(
      {
        ...straightGamesWin,
        discipline: 'DOUBLES',
        partners: [{ name: 'Arun' }],
        opponents: [{ name: 'Meera' }, { name: 'Sam' }],
      },
      db,
    );

    expect(match.partnerNames).toEqual(['Arun']);
    expect(match.opponentNames).toEqual(['Meera', 'Sam']);
    expect(await listPlayers(undefined, db)).toHaveLength(3);
  });
});
