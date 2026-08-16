/**
 * Small numeric helpers shared by the analytics engine.
 *
 * The two rules everything here obeys:
 *  1. A rate with a zero denominator is `null` (unknown), never `0`.
 *  2. Rounding happens once, at the edge, to a fixed number of decimals so that API
 *     responses are stable and snapshot-testable.
 */

export const PERCENT_DECIMALS = 1;
export const AVERAGE_DECIMALS = 2;

export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  // `Number.EPSILON` nudges values such as 1.005 onto the correct side of the boundary.
  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
}

/** Percentage of `numerator` within `denominator`, or null when the denominator is zero. */
export function percentage(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return round((numerator / denominator) * 100, PERCENT_DECIMALS);
}

/** Mean of a list, or null when empty. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return round(total / values.length, AVERAGE_DECIMALS);
}

/** Population standard deviation, or null when fewer than two samples. */
export function standardDeviation(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return round(Math.sqrt(variance), AVERAGE_DECIMALS);
}

/**
 * Least-squares slope of `values` against their index.
 * Returns null when there are fewer than three points, since a slope through two points
 * is a line, not a trend.
 */
export function linearSlope(values: ReadonlyArray<number | null>): number | null {
  const points = values
    .map((value, index) => ({ x: index, y: value }))
    .filter((point): point is { x: number; y: number } => point.y !== null);

  if (points.length < 3) return null;

  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;

  return round((n * sumXY - sumX * sumY) / denominator, AVERAGE_DECIMALS);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
