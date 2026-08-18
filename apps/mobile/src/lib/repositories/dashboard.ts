import type { SQLiteDatabase } from 'expo-sqlite';
import { aggregate, type MatchRecord } from '@badminton/analytics';
import { listMatches, type CachedMatch } from '../db/cache';

/**
 * The dashboard's numbers, computed on the device from the local cache.
 *
 * Deliberately not fetched from the analytics API. The dashboard has to render at the
 * side of a court with no signal, and it has to include the match recorded thirty seconds
 * ago that the server has not seen yet — a server-computed figure would be wrong until
 * the queue drained.
 *
 * They agree because both sides call the same `aggregate` from the shared analytics
 * package over the same raw matches. That is the whole reason the package is
 * framework-free: it runs in Node on the server and in Hermes on the phone, and gives the
 * same answer in both.
 */

export interface DashboardSummary {
  totalMatches: number;
  wins: number;
  losses: number;
  /** Null rather than zero when nothing has been played: they are different facts. */
  winRate: number | null;
  pointWinRate: number | null;
  currentStreak: { kind: 'WIN' | 'LOSS'; length: number } | null;
  recent: CachedMatch[];
  /** Win rate over the last ten matches, for comparison with the lifetime figure. */
  recentWinRate: number | null;
  pendingCount: number;
}

const RECENT_WINDOW = 10;

export async function loadDashboard(db?: SQLiteDatabase): Promise<DashboardSummary> {
  // Bounded rather than unbounded: a few years of play is a few thousand matches, and
  // reading all of them on every dashboard render would make the screen visibly slow.
  const matches = await listMatches({ limit: 500 }, db);

  const records = matches.map(toRecord);
  const summary = aggregate(records);

  const recent = matches.slice(0, RECENT_WINDOW);
  const recentSummary = aggregate(recent.map(toRecord));

  return {
    totalMatches: summary.matches,
    wins: summary.wins,
    losses: summary.losses,
    winRate: summary.winRate,
    pointWinRate: summary.pointWinRate,
    currentStreak: currentStreak(matches),
    recent: matches.slice(0, 5),
    recentWinRate: recentSummary.winRate,
    pendingCount: matches.filter((match) => match.pendingLocal).length,
  };
}

/**
 * The run of results ending with the most recent match.
 *
 * Null when nothing has been played. A streak of zero is not a thing, and rendering one
 * would be a claim about a person's form that the data does not support.
 */
function currentStreak(matches: CachedMatch[]): { kind: 'WIN' | 'LOSS'; length: number } | null {
  const [latest] = matches;
  if (!latest) return null;
  if (latest.derived.result !== 'WIN' && latest.derived.result !== 'LOSS') return null;

  const kind = latest.derived.result;
  let length = 0;

  for (const match of matches) {
    if (match.derived.result !== kind) break;
    length += 1;
  }

  return { kind, length };
}

/**
 * A cached match in the shape the analytics package expects.
 *
 * The cache stores what the sync feed sent, which is close but not identical — dates
 * arrive as strings over JSON and the package works in `Date`.
 */
function toRecord(match: CachedMatch): MatchRecord {
  return {
    id: match.id,
    sessionId: match.sessionId,
    playedAt: new Date(match.playedAt),
    orderInSession: match.orderInSession,
    discipline: match.discipline,
    // The sync feed does not carry the session type; every aggregate the dashboard shows
    // is across all of them, so a constant is honest here rather than a guess that could
    // be read as fact.
    sessionType: 'CASUAL',
    venueId: match.venue?.id ?? null,
    venueName: match.venue?.name ?? null,
    scoring: match.scoring,
    durationSeconds: match.durationSeconds,
    difficulty: match.difficulty,
    tags: match.tags,
    partnerIds: match.partnerIds,
    opponentIds: match.opponentIds,
    games: match.games.map((game) => ({
      myScore: game.myScore,
      opponentScore: game.opponentScore,
    })),
  };
}
