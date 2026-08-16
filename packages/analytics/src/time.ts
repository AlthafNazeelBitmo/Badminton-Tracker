import type { PeriodGranularity } from '@badminton/contracts';

/**
 * Time-zone-aware bucketing without a date library.
 *
 * Everything is stored in UTC, but "matches this week" must mean the user's week. These
 * helpers project an instant into a target IANA zone using `Intl.DateTimeFormat` (built
 * into Node and every browser) and then do plain calendar arithmetic on the projected
 * civil date. That keeps buckets correct across DST transitions without pulling in a
 * multi-megabyte dependency.
 */

export interface CivilDate {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Returns true when the string is an IANA zone this runtime understands. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Projects an instant onto the calendar date observed in `timeZone`. */
export function toCivilDate(instant: Date, timeZone: string): CivilDate {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const lookup = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };
  return { year: lookup('year'), month: lookup('month'), day: lookup('day') };
}

export function civilToISODate(date: CivilDate): string {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

/** `2026-08-16` for the calendar day the instant falls on in `timeZone`. */
export function isoDayKey(instant: Date, timeZone: string): string {
  return civilToISODate(toCivilDate(instant, timeZone));
}

/** Day of week for a civil date, 1 = Monday … 7 = Sunday (ISO-8601). */
export function isoWeekday(date: CivilDate): number {
  const utc = Date.UTC(date.year, date.month - 1, date.day);
  const jsDay = new Date(utc).getUTCDay(); // 0 = Sunday
  return jsDay === 0 ? 7 : jsDay;
}

/** Monday of the ISO week containing the given civil date. */
export function startOfIsoWeek(date: CivilDate): CivilDate {
  const utc = Date.UTC(date.year, date.month - 1, date.day);
  const monday = new Date(utc - (isoWeekday(date) - 1) * 86_400_000);
  return {
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate(),
  };
}

/**
 * Key identifying the bucket an instant belongs to, and the ISO date that bucket starts
 * on. Keys sort lexicographically in chronological order, which is what the trend
 * builder relies on.
 */
export function bucketKey(
  instant: Date,
  granularity: PeriodGranularity,
  timeZone: string,
): { key: string; startISO: string; label: string } {
  const civil = toCivilDate(instant, timeZone);

  switch (granularity) {
    case 'DAY': {
      const iso = civilToISODate(civil);
      return { key: iso, startISO: iso, label: iso };
    }
    case 'WEEK': {
      const monday = startOfIsoWeek(civil);
      const iso = civilToISODate(monday);
      return { key: iso, startISO: iso, label: `Week of ${iso}` };
    }
    case 'MONTH': {
      const start = civilToISODate({ year: civil.year, month: civil.month, day: 1 });
      const key = `${civil.year}-${String(civil.month).padStart(2, '0')}`;
      return { key, startISO: start, label: monthLabel(civil.year, civil.month) };
    }
    case 'YEAR': {
      const start = civilToISODate({ year: civil.year, month: 1, day: 1 });
      return { key: String(civil.year), startISO: start, label: String(civil.year) };
    }
  }
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? month} ${year}`;
}

export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** Inclusive list of ISO day strings between two civil dates. */
export function eachDayISO(from: CivilDate, to: CivilDate): string[] {
  const days: string[] = [];
  let cursor = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  // Guard against pathological ranges; 20 years of days is plenty for a heatmap.
  const limit = 366 * 20;
  while (cursor <= end && days.length < limit) {
    const date = new Date(cursor);
    days.push(
      civilToISODate({
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
      }),
    );
    cursor += 86_400_000;
  }
  return days;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
