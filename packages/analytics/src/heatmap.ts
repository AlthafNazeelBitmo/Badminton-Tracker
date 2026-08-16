import type { HeatmapDay, HeatmapResponse } from '@badminton/contracts';
import type { MatchRecord } from './types';
import { deriveMatch } from './derive';
import { WEEKDAY_NAMES, bucketKey, isoDayKey, isoWeekday, monthLabel, toCivilDate } from './time';
import { round } from './math';

/**
 * Calendar activity heatmap, GitHub-contribution style.
 *
 * Days with no activity are included with zero counts so the calendar grid renders
 * without gaps. That is safe here because "no sessions on this day" is a real fact,
 * unlike an imputed 0% win rate.
 */
export function buildHeatmap(
  matches: readonly MatchRecord[],
  from: Date,
  to: Date,
  timeZone: string,
): HeatmapResponse {
  const days = new Map<string, HeatmapDay>();
  const sessionsPerDay = new Map<string, Set<string>>();

  for (const match of matches) {
    const key = isoDayKey(match.playedAt, timeZone);
    const day = days.get(key) ?? { date: key, sessions: 0, matches: 0, wins: 0, losses: 0 };
    day.matches += 1;

    const result = deriveMatch(match).result;
    if (result === 'WIN') day.wins += 1;
    else if (result === 'LOSS') day.losses += 1;

    const sessions = sessionsPerDay.get(key) ?? new Set<string>();
    sessions.add(match.sessionId);
    sessionsPerDay.set(key, sessions);
    day.sessions = sessions.size;

    days.set(key, day);
  }

  const fromCivil = toCivilDate(from, timeZone);
  const toCivil = toCivilDate(to, timeZone);
  const orderedKeys = [...days.keys()].sort();

  // Weekday and month activity.
  const weekdayCounts = new Map<number, number>();
  const monthCounts = new Map<string, { label: string; sessions: number }>();

  for (const [key, day] of days) {
    const [year, month, dayOfMonth] = key.split('-').map(Number);
    if (year === undefined || month === undefined || dayOfMonth === undefined) continue;
    const weekday = isoWeekday({ year, month, day: dayOfMonth });
    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + day.sessions);

    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const existing = monthCounts.get(monthKey);
    if (existing) existing.sessions += day.sessions;
    else monthCounts.set(monthKey, { label: monthLabel(year, month), sessions: day.sessions });
  }

  const mostActiveWeekday = [...weekdayCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const mostActiveMonth = [...monthCounts.entries()].sort((a, b) => b[1].sessions - a[1].sessions)[0] ?? null;

  const totalSessions = [...sessionsPerDay.values()].reduce((total, set) => total + set.size, 0);
  const spanDays = Math.max(
    1,
    Math.round(
      (Date.UTC(toCivil.year, toCivil.month - 1, toCivil.day) -
        Date.UTC(fromCivil.year, fromCivil.month - 1, fromCivil.day)) /
        86_400_000,
    ) + 1,
  );

  return {
    from: `${fromCivil.year}-${String(fromCivil.month).padStart(2, '0')}-${String(fromCivil.day).padStart(2, '0')}`,
    to: `${toCivil.year}-${String(toCivil.month).padStart(2, '0')}-${String(toCivil.day).padStart(2, '0')}`,
    days: orderedKeys.map((key) => days.get(key)!),
    mostActiveWeekday: mostActiveWeekday
      ? { weekday: mostActiveWeekday[0], sessions: mostActiveWeekday[1] }
      : null,
    mostActiveMonth: mostActiveMonth
      ? { month: mostActiveMonth[1].label, sessions: mostActiveMonth[1].sessions }
      : null,
    averageSessionsPerWeek:
      totalSessions === 0 ? null : round((totalSessions / spanDays) * 7, 2),
    longestActiveStreakDays: longestConsecutiveDays(orderedKeys),
  };
}

export function weekdayName(isoWeekdayNumber: number): string {
  return WEEKDAY_NAMES[isoWeekdayNumber - 1] ?? 'Unknown';
}

/** Longest run of consecutive calendar days on which the user played. */
export function longestConsecutiveDays(sortedDayKeys: readonly string[]): number {
  let longest = 0;
  let run = 0;
  let previous: number | null = null;

  for (const key of sortedDayKeys) {
    const [year, month, day] = key.split('-').map(Number);
    if (year === undefined || month === undefined || day === undefined) continue;
    const timestamp = Date.UTC(year, month - 1, day);
    run = previous !== null && timestamp - previous === 86_400_000 ? run + 1 : 1;
    previous = timestamp;
    longest = Math.max(longest, run);
  }

  return longest;
}

/** Number of distinct calendar days with recorded activity in the window. */
export function activeDays(matches: readonly MatchRecord[], timeZone: string): number {
  return new Set(matches.map((match) => isoDayKey(match.playedAt, timeZone))).size;
}

/** Sessions per calendar month, used by the activity summary card. */
export function sessionsPerMonth(
  matches: readonly MatchRecord[],
  timeZone: string,
): Array<{ month: string; sessions: number; matches: number }> {
  const months = new Map<string, { label: string; sessions: Set<string>; matches: number }>();

  for (const match of matches) {
    const { key, label } = bucketKey(match.playedAt, 'MONTH', timeZone);
    const bucket = months.get(key) ?? { label, sessions: new Set<string>(), matches: 0 };
    bucket.sessions.add(match.sessionId);
    bucket.matches += 1;
    months.set(key, bucket);
  }

  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, bucket]) => ({
      month: bucket.label,
      sessions: bucket.sessions.size,
      matches: bucket.matches,
    }));
}
