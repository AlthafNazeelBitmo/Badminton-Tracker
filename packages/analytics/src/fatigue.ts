import type { FatigueResponse } from '@badminton/contracts';
import { ANALYTICS_CONSTANTS, type MatchRecord } from './types';
import { aggregate } from './aggregate';
import { round } from './math';

/**
 * Performance by position within a session.
 *
 * Buckets matches by `orderInSession` so the fifth match of every session is compared
 * against the first. Sessions of different lengths are handled naturally: a session with
 * three matches simply contributes nothing to buckets 4 and 5.
 *
 * This is an observation about scorelines. It is deliberately *not* framed as a medical
 * or physiological finding — the wording below says "appears to", and the caller is
 * expected to keep it that way.
 */
export function fatigueAnalysis(matches: readonly MatchRecord[]): FatigueResponse {
  const byPosition = new Map<number, MatchRecord[]>();
  const sessionsByPosition = new Map<number, Set<string>>();

  for (const match of matches) {
    const position = Math.max(1, match.orderInSession);
    const bucket = byPosition.get(position);
    if (bucket) bucket.push(match);
    else byPosition.set(position, [match]);

    const sessions = sessionsByPosition.get(position) ?? new Set<string>();
    sessions.add(match.sessionId);
    sessionsByPosition.set(position, sessions);
  }

  const buckets = [...byPosition.entries()]
    .sort(([a], [b]) => a - b)
    .map(([matchNumber, group]) => ({
      matchNumber,
      stats: aggregate(group),
      sessionsSampled: sessionsByPosition.get(matchNumber)?.size ?? 0,
    }));

  const distinctSessions = new Set(matches.map((match) => match.sessionId)).size;
  if (buckets.length < 2 || distinctSessions < ANALYTICS_CONSTANTS.minSessionsForFatigue) {
    return { buckets, earlyVsLateWinRateDelta: null, observation: null };
  }

  // Compare the first third of positions against the last third.
  const third = Math.max(1, Math.floor(buckets.length / 3));
  const early = buckets.slice(0, third);
  const late = buckets.slice(-third);

  const earlyRate = weightedWinRate(early);
  const lateRate = weightedWinRate(late);

  if (earlyRate === null || lateRate === null) {
    return { buckets, earlyVsLateWinRateDelta: null, observation: null };
  }

  const delta = round(lateRate - earlyRate, 1);
  let observation: string;
  if (delta <= -10) {
    observation = `Win rate appears to decline later in sessions: ${earlyRate}% in the earliest matches versus ${lateRate}% in the latest.`;
  } else if (delta >= 10) {
    observation = `Win rate appears to improve later in sessions: ${earlyRate}% in the earliest matches versus ${lateRate}% in the latest.`;
  } else {
    observation = `Win rate is broadly stable across a session (${earlyRate}% early versus ${lateRate}% late).`;
  }

  return { buckets, earlyVsLateWinRateDelta: delta, observation };
}

function weightedWinRate(
  buckets: ReadonlyArray<{ stats: { wins: number; matches: number } }>,
): number | null {
  const wins = buckets.reduce((total, bucket) => total + bucket.stats.wins, 0);
  const played = buckets.reduce((total, bucket) => total + bucket.stats.matches, 0);
  if (played === 0) return null;
  return round((wins / played) * 100, 1);
}
