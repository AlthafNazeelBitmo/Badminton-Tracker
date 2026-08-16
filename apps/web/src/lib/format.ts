/**
 * Formatting helpers.
 *
 * Two rules run through all of this:
 *  1. An unknown value (`null`) renders as an em dash, never as `0`. A player with no
 *     matches has an unknown win rate, and the interface must say so.
 *  2. Dates are formatted with `Intl` in the user's locale and time zone. No format
 *     string is hardcoded, so 16/08/2026 and 8/16/2026 both come out right.
 */

export const EM_DASH = '—';

export function percent(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined) return EM_DASH;
  return `${value.toFixed(decimals)}%`;
}

export function number(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return EM_DASH;
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Signed value, for point differentials where the sign is the point. */
export function signed(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined) return EM_DASH;
  const formatted = Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return '0';
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds <= 0) return EM_DASH;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} min`;
}

/** Total playing time, phrased for a headline figure rather than a match length. */
export function totalTime(seconds: number | null | undefined): string {
  if (!seconds) return EM_DASH;
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} min`;
  if (hours < 100) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours)} h`;
}

export function formatDate(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  if (!value) return EM_DASH;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatShortDate(value: string | Date | null | undefined): string {
  return formatDate(value, { day: 'numeric', month: 'short' });
}

/** "3 days ago", "in 2 weeks" — relative phrasing without a date library. */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return EM_DASH;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EM_DASH;

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, 'second');
}

/** `21-18, 19-21, 21-16` from a match's games. */
export function scoreline(games: ReadonlyArray<{ myScore: number; opponentScore: number }>): string {
  return games.map((game) => `${game.myScore}–${game.opponentScore}`).join(', ');
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Joins names for prose: "John", "John & Ahmed", "John, Ahmed & Priya". */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return 'Unknown';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** The browser's IANA time zone, so analytics buckets match the user's calendar. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
