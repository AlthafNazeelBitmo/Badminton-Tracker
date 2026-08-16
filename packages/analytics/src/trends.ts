import type { PeriodGranularity, TrendPoint, TrendResponse } from '@badminton/contracts';
import type { MatchRecord } from './types';
import { aggregate, byPlayedAtAscending } from './aggregate';
import { bucketKey } from './time';
import { linearSlope } from './math';

/**
 * Buckets matches by calendar period and aggregates each bucket.
 *
 * Only periods in which matches were actually played appear. Padding the series with
 * empty months would draw a win rate of "0%" for months the user did not play, which is
 * a lie the charts must not tell.
 */
export function buildTrend(
  matches: readonly MatchRecord[],
  granularity: PeriodGranularity,
  timeZone: string,
): TrendResponse {
  const buckets = new Map<string, { startISO: string; label: string; matches: MatchRecord[] }>();

  for (const match of matches) {
    const { key, startISO, label } = bucketKey(match.playedAt, granularity, timeZone);
    const existing = buckets.get(key);
    if (existing) existing.matches.push(match);
    else buckets.set(key, { startISO, label, matches: [match] });
  }

  const points: TrendPoint[] = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bucket]) => ({
      periodStart: bucket.startISO,
      label: bucket.label,
      stats: aggregate([...bucket.matches].sort(byPlayedAtAscending)),
    }));

  return {
    granularity,
    points,
    winRateTrendPerPeriod: linearSlope(points.map((point) => point.stats.winRate)),
  };
}

/**
 * Rolling win rate over the last `window` matches, in chronological order.
 * Used for the "recent form" sparkline, where a monthly bucket is too coarse.
 */
export function rollingWinRate(
  matches: readonly MatchRecord[],
  window = 10,
): Array<{ playedAt: string; winRate: number }> {
  const ordered = [...matches].sort(byPlayedAtAscending);
  const output: Array<{ playedAt: string; winRate: number }> = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const start = Math.max(0, index - window + 1);
    const slice = ordered.slice(start, index + 1);
    const stats = aggregate(slice);
    const current = ordered[index];
    if (!current || stats.winRate === null) continue;
    output.push({ playedAt: current.playedAt.toISOString(), winRate: stats.winRate });
  }

  return output;
}
