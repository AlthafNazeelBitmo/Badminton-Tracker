import { DEFAULT_SCORING_RULES, type ScoreLine } from '@badminton/contracts';
import type { MatchRecord } from '../types';

let sequence = 0;

/**
 * Builds a `MatchRecord` with sensible defaults so tests only state what they care about.
 * Exported from the package (rather than kept in a test file) so the API's integration
 * tests can build the same fixtures.
 */
export function makeMatch(overrides: Partial<MatchRecord> = {}): MatchRecord {
  sequence += 1;
  return {
    id: `match-${sequence}`,
    sessionId: 'session-1',
    playedAt: new Date('2026-08-01T18:00:00.000Z'),
    orderInSession: 1,
    discipline: 'SINGLES',
    sessionType: 'CASUAL',
    venueId: 'venue-1',
    venueName: 'Riverside',
    scoring: { ...DEFAULT_SCORING_RULES },
    durationSeconds: 1800,
    difficulty: 3,
    tags: [],
    partnerIds: [],
    opponentIds: ['opponent-1'],
    games: [
      { myScore: 21, opponentScore: 18 },
      { myScore: 21, opponentScore: 17 },
    ],
    ...overrides,
  };
}

/** `games('21-18', '19-21', '21-16')` → score lines, keeping test tables readable. */
export function games(...scores: string[]): ScoreLine[] {
  return scores.map((score) => {
    const [mine, theirs] = score.split('-').map(Number);
    if (mine === undefined || theirs === undefined) {
      throw new Error(`Invalid score fixture: ${score}`);
    }
    return { myScore: mine, opponentScore: theirs };
  });
}

/** A chronological run of matches, one per day, from the given results. */
export function matchSequence(
  results: Array<'W' | 'L'>,
  overrides: Partial<MatchRecord> = {},
): MatchRecord[] {
  return results.map((result, index) =>
    makeMatch({
      playedAt: new Date(Date.UTC(2026, 0, index + 1, 18)),
      sessionId: `session-${index + 1}`,
      orderInSession: 1,
      games: result === 'W' ? games('21-15', '21-15') : games('15-21', '15-21'),
      ...overrides,
    }),
  );
}

export function resetSequence(): void {
  sequence = 0;
}
