import type {
  BreakdownEntry,
  Discipline,
  PerformanceStats,
  TagCorrelation,
  PerformanceTag,
} from '@badminton/contracts';
import { PERFORMANCE_TAGS } from '@badminton/contracts';
import type { MatchRecord } from './types';
import { aggregate, byPlayedAtAscending, computeStreaks } from './aggregate';
import { deriveMatch, formatScoreline } from './derive';
import { round } from './math';

/**
 * Groups matches by an arbitrary key and produces the standard breakdown entry for each
 * group. A match can contribute to several groups (a doubles match has two opponents),
 * which is why the key extractor returns an array.
 */
export function groupMatches<TKey extends string>(
  matches: readonly MatchRecord[],
  keysOf: (match: MatchRecord) => TKey[],
): Map<TKey, MatchRecord[]> {
  const groups = new Map<TKey, MatchRecord[]>();
  for (const match of matches) {
    for (const key of keysOf(match)) {
      const bucket = groups.get(key);
      if (bucket) bucket.push(match);
      else groups.set(key, [match]);
    }
  }
  return groups;
}

/** Builds the shared breakdown block: stats, streaks, first/last played, best/worst result. */
export function buildBreakdown<TSubject>(
  subject: TSubject,
  matches: readonly MatchRecord[],
): BreakdownEntry<TSubject> {
  const ordered = [...matches].sort(byPlayedAtAscending);
  const stats = aggregate(ordered);

  let best: BreakdownEntry<TSubject>['bestResult'] = null;
  let worst: BreakdownEntry<TSubject>['worstResult'] = null;

  for (const match of ordered) {
    const derived = deriveMatch(match);
    const entry = {
      matchId: match.id,
      playedAt: match.playedAt.toISOString(),
      score: formatScoreline(match.games),
      margin: derived.pointDifferential,
    };
    // "Best" is the largest positive point differential, "worst" the most negative.
    if (!best || entry.margin > best.margin) best = entry;
    if (!worst || entry.margin < worst.margin) worst = entry;
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  return {
    subject,
    stats,
    streaks: computeStreaks(ordered),
    firstPlayedAt: first ? first.playedAt.toISOString() : null,
    lastPlayedAt: last ? last.playedAt.toISOString() : null,
    bestResult: best,
    worstResult: worst,
  };
}

export function breakdownByOpponent(matches: readonly MatchRecord[]): Map<string, MatchRecord[]> {
  return groupMatches(matches, (match) => match.opponentIds);
}

export function breakdownByPartner(matches: readonly MatchRecord[]): Map<string, MatchRecord[]> {
  return groupMatches(matches, (match) => match.partnerIds);
}

export function breakdownByVenue(matches: readonly MatchRecord[]): Map<string, MatchRecord[]> {
  // Matches without a venue are grouped under the empty key and surfaced as "Unspecified".
  return groupMatches(matches, (match) => [match.venueId ?? '']);
}

export function breakdownByDiscipline(
  matches: readonly MatchRecord[],
): Map<Discipline, MatchRecord[]> {
  return groupMatches<Discipline>(matches, (match) => [match.discipline]);
}

export function breakdownBySession(matches: readonly MatchRecord[]): Map<string, MatchRecord[]> {
  return groupMatches(matches, (match) => [match.sessionId]);
}

/**
 * Win rate for matches carrying each tag, alongside the delta against the overall rate.
 *
 * This is an association, not a cause: tags are applied after the fact and a losing
 * match is more likely to be tagged "unforced errors". The API labels these as
 * observations for exactly that reason.
 */
export function tagCorrelations(matches: readonly MatchRecord[]): TagCorrelation[] {
  const overall = aggregate(matches);
  const correlations: TagCorrelation[] = [];

  for (const tag of PERFORMANCE_TAGS) {
    const tagged = matches.filter((match) => match.tags.includes(tag as PerformanceTag));
    if (tagged.length === 0) continue;

    const stats = aggregate(tagged);
    correlations.push({
      tag: tag as PerformanceTag,
      matches: stats.matches,
      wins: stats.wins,
      winRate: stats.winRate,
      winRateDelta:
        stats.winRate === null || overall.winRate === null
          ? null
          : round(stats.winRate - overall.winRate, 1),
    });
  }

  return correlations.sort((a, b) => b.matches - a.matches);
}

/** Stats for matches at each subjective difficulty level (1–5). */
export function breakdownByDifficulty(
  matches: readonly MatchRecord[],
): Array<{ difficulty: number; stats: PerformanceStats }> {
  const groups = groupMatches(
    matches.filter((match) => match.difficulty != null),
    (match) => [String(match.difficulty)],
  );

  return [...groups.entries()]
    .map(([key, group]) => ({ difficulty: Number(key), stats: aggregate(group) }))
    .sort((a, b) => a.difficulty - b.difficulty);
}
