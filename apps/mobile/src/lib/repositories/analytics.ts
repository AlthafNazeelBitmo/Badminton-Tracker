import type { SQLiteDatabase } from 'expo-sqlite';
import type { PerformanceStats } from '@badminton/contracts';
import { aggregate, type MatchRecord } from '@badminton/analytics';
import { listMatches, listPlayers, type CachedMatch } from '../db/cache';

/**
 * Analytics from the local cache.
 *
 * Every figure comes from the shared `aggregate` over raw matches, exactly as the server
 * computes it — same function, same inputs, same answer. Nothing is stored pre-computed,
 * so changing how a metric is defined changes every historical figure with it, which is
 * the property the specification asked for.
 */

export interface AnalyticsRow {
  key: string;
  label: string;
  matches: number;
  /** Null when the rate has no meaning, never zero. */
  winRate: number | null;
}

export interface MobileAnalytics {
  stats: PerformanceStats;
  opponents: AnalyticsRow[];
  disciplines: AnalyticsRow[];
  weekdays: AnalyticsRow[];
}

/**
 * Below this, a win rate says more about luck than about the opponent.
 *
 * Rows under the threshold are still listed — hiding somebody you have played twice would
 * be its own kind of lie — but they sort last, so the list is not headed by a 100% built
 * on a single match.
 */
const MEANINGFUL_SAMPLE = 3;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const DISCIPLINE_LABELS: Record<string, string> = {
  SINGLES: 'Singles',
  DOUBLES: 'Doubles',
  MIXED_DOUBLES: 'Mixed doubles',
};

export async function loadAnalytics(db?: SQLiteDatabase): Promise<MobileAnalytics> {
  const [matches, players] = await Promise.all([
    listMatches({ limit: 1000 }, db),
    listPlayers(undefined, db),
  ]);

  const records = matches.map(toRecord);
  const names = new Map(players.map((player) => [player.id, player.name]));

  return {
    stats: aggregate(records),
    opponents: rank(
      groupBy(matches, (match) => match.opponentIds),
      (id) => names.get(id) ?? 'Unknown',
    ),
    disciplines: rank(
      groupBy(matches, (match) => [match.discipline]),
      (key) => DISCIPLINE_LABELS[key] ?? key,
    ),
    weekdays: rank(
      groupBy(matches, (match) => [String(new Date(match.playedAt).getDay())]),
      (key) => WEEKDAYS[Number(key)] ?? key,
      // Chronological, because a week has an order and reordering it by win rate makes
      // the axis meaningless.
      (a, b) => Number(a.key) - Number(b.key),
    ),
  };
}

function groupBy(
  matches: CachedMatch[],
  keysOf: (match: CachedMatch) => string[],
): Map<string, CachedMatch[]> {
  const groups = new Map<string, CachedMatch[]>();

  for (const match of matches) {
    for (const key of keysOf(match)) {
      if (!key) continue;
      const bucket = groups.get(key);
      if (bucket) bucket.push(match);
      else groups.set(key, [match]);
    }
  }

  return groups;
}

function rank(
  groups: Map<string, CachedMatch[]>,
  label: (key: string) => string,
  sort?: (a: AnalyticsRow, b: AnalyticsRow) => number,
): AnalyticsRow[] {
  const rows: AnalyticsRow[] = [...groups.entries()].map(([key, matches]) => {
    const stats = aggregate(matches.map(toRecord));
    return { key, label: label(key), matches: stats.matches, winRate: stats.winRate };
  });

  if (sort) return rows.sort(sort);

  return rows.sort((a, b) => {
    // Thin samples sort last whatever their rate, so the list is not headed by a 100%
    // drawn from one match.
    const aThin = a.matches < MEANINGFUL_SAMPLE;
    const bThin = b.matches < MEANINGFUL_SAMPLE;
    if (aThin !== bThin) return aThin ? 1 : -1;

    if (b.matches !== a.matches) return b.matches - a.matches;
    return (b.winRate ?? 0) - (a.winRate ?? 0);
  });
}

function toRecord(match: CachedMatch): MatchRecord {
  return {
    id: match.id,
    sessionId: match.sessionId,
    playedAt: new Date(match.playedAt),
    orderInSession: match.orderInSession,
    discipline: match.discipline,
    // Not carried by the sync feed. Nothing on this screen breaks it down by session
    // type, so a constant is honest rather than a guess presented as fact.
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
