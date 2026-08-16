import type { Insight, InsightSentiment } from '@badminton/contracts';
import { ANALYTICS_CONSTANTS, type MatchRecord } from './types';
import { aggregate, byPlayedAtAscending, computeStreaks } from './aggregate';
import {
  breakdownByDiscipline,
  breakdownByPartner,
  breakdownByVenue,
  groupMatches,
} from './breakdowns';
import { situationalAnalysis } from './situational';
import { fatigueAnalysis } from './fatigue';
import { daysBetween } from './time';
import { round } from './math';

export interface InsightContext {
  timeZone: string;
  now: Date;
  playerName: (playerId: string) => string;
  venueName: (venueId: string) => string;
}

/**
 * Generates plain-language insights strictly from the supplied matches.
 *
 * Three rules, enforced by construction:
 *  1. **No fabrication.** Every sentence is built from numbers computed in this file and
 *     the numbers are attached as `evidence`, so any claim can be checked.
 *  2. **Minimum samples.** A generator that cannot meet its sample-size threshold returns
 *     nothing rather than a shaky claim.
 *  3. **Separated claim strength.** `OBSERVATION` states what the data says,
 *     `INTERPRETATION` offers a reading of it, `RECOMMENDATION` suggests an action.
 *     Nothing is ever promoted from one level to another.
 */
export function generateInsights(
  matches: readonly MatchRecord[],
  context: InsightContext,
): Insight[] {
  const ordered = [...matches].sort(byPlayedAtAscending);
  if (ordered.length === 0) return [];

  const insights: Insight[] = [];
  const push = (insight: Insight) => insights.push(insight);

  const overall = aggregate(ordered);

  // --- Recent form ---------------------------------------------------------
  const recentWindow = Math.min(10, ordered.length);
  if (recentWindow >= 5) {
    const recent = ordered.slice(-recentWindow);
    const recentStats = aggregate(recent);
    push({
      id: 'recent-form',
      kind: 'OBSERVATION',
      sentiment: sentimentFromWinRate(recentStats.winRate),
      title: `You have won ${recentStats.wins} of your last ${recentWindow} matches.`,
      detail: `That is a ${formatRate(recentStats.winRate)} win rate over your most recent matches, against ${formatRate(overall.winRate)} across the whole period.`,
      evidence: {
        recentWins: recentStats.wins,
        recentMatches: recentWindow,
        recentWinRate: recentStats.winRate,
        overallWinRate: overall.winRate,
      },
      sampleSize: recentWindow,
    });
  }

  // --- Current streak ------------------------------------------------------
  const streaks = computeStreaks(ordered);
  if (streaks.currentWinStreak >= 3) {
    push({
      id: 'current-win-streak',
      kind: 'OBSERVATION',
      sentiment: 'POSITIVE',
      title: `You are on a ${streaks.currentWinStreak}-match winning streak.`,
      detail: `Your best run recorded so far is ${streaks.bestWinStreak} matches.`,
      evidence: { current: streaks.currentWinStreak, best: streaks.bestWinStreak },
      sampleSize: streaks.currentWinStreak,
    });
  } else if (streaks.currentLossStreak >= 3) {
    push({
      id: 'current-loss-streak',
      kind: 'OBSERVATION',
      sentiment: 'NEGATIVE',
      title: `You have lost your last ${streaks.currentLossStreak} matches.`,
      detail: `Your longest losing run recorded so far is ${streaks.worstLossStreak} matches.`,
      evidence: { current: streaks.currentLossStreak, worst: streaks.worstLossStreak },
      sampleSize: streaks.currentLossStreak,
    });
  }

  // --- Singles versus doubles ---------------------------------------------
  const disciplines = breakdownByDiscipline(ordered);
  const singles = disciplines.get('SINGLES') ?? [];
  const doubles = [
    ...(disciplines.get('DOUBLES') ?? []),
    ...(disciplines.get('MIXED_DOUBLES') ?? []),
  ];
  const min = ANALYTICS_CONSTANTS.minMatchesForInsight;

  if (singles.length >= min && doubles.length >= min) {
    const singlesStats = aggregate(singles);
    const doublesStats = aggregate(doubles);
    if (singlesStats.winRate !== null && doublesStats.winRate !== null) {
      const gap = round(doublesStats.winRate - singlesStats.winRate, 1);
      if (Math.abs(gap) >= 10) {
        const stronger = gap > 0 ? 'doubles' : 'singles';
        push({
          id: 'discipline-gap',
          kind: 'INTERPRETATION',
          sentiment: 'NEUTRAL',
          title: `Your ${stronger} win rate is currently ${Math.abs(gap)} points higher.`,
          detail: `Singles ${formatRate(singlesStats.winRate)} across ${singles.length} matches, doubles ${formatRate(doublesStats.winRate)} across ${doubles.length}. Different opposition in each format can explain part of this gap.`,
          evidence: {
            singlesWinRate: singlesStats.winRate,
            singlesMatches: singles.length,
            doublesWinRate: doublesStats.winRate,
            doublesMatches: doubles.length,
            gap,
          },
          sampleSize: singles.length + doubles.length,
        });
      }
    }
  }

  // --- Toughest and most comfortable opponents -----------------------------
  const opponentGroups = groupMatches(ordered, (match) => match.opponentIds);
  const rankedOpponents = [...opponentGroups.entries()]
    .filter(([, group]) => group.length >= min)
    .map(([playerId, group]) => ({ playerId, group, stats: aggregate(group) }))
    .filter((entry) => entry.stats.winRate !== null)
    .sort((a, b) => (a.stats.winRate ?? 0) - (b.stats.winRate ?? 0));

  const toughest = rankedOpponents[0];
  if (toughest && (toughest.stats.winRate ?? 100) < 50) {
    push({
      id: `toughest-opponent-${toughest.playerId}`,
      kind: 'OBSERVATION',
      sentiment: 'NEGATIVE',
      title: `You have won ${toughest.stats.wins} of ${toughest.stats.matches} against ${context.playerName(toughest.playerId)}.`,
      detail: `That is your lowest win rate against any opponent you have faced at least ${min} times (${formatRate(toughest.stats.winRate)}, point differential ${signed(toughest.stats.pointDifferential)}).`,
      evidence: {
        opponent: context.playerName(toughest.playerId),
        wins: toughest.stats.wins,
        matches: toughest.stats.matches,
        winRate: toughest.stats.winRate,
        pointDifferential: toughest.stats.pointDifferential,
      },
      sampleSize: toughest.stats.matches,
    });
  }

  // --- Deciding games against the toughest opponent ------------------------
  if (toughest) {
    const deciderMatches = toughest.group.filter(
      (match) => match.games.length === match.scoring.bestOf && match.scoring.bestOf > 1,
    );
    if (deciderMatches.length >= 3) {
      const deciderStats = aggregate(deciderMatches);
      if (deciderStats.winRate !== null && deciderStats.winRate < 50) {
        push({
          id: `decider-vs-${toughest.playerId}`,
          kind: 'OBSERVATION',
          sentiment: 'NEGATIVE',
          title: `Deciding games against ${context.playerName(toughest.playerId)} have gone against you.`,
          detail: `You have won ${deciderStats.wins} of ${deciderStats.matches} matches that went the distance against them.`,
          evidence: {
            opponent: context.playerName(toughest.playerId),
            wins: deciderStats.wins,
            matches: deciderStats.matches,
            winRate: deciderStats.winRate,
          },
          sampleSize: deciderStats.matches,
        });
      }
    }
  }

  // --- Best partnership ----------------------------------------------------
  const partnerGroups = breakdownByPartner(ordered);
  const rankedPartners = [...partnerGroups.entries()]
    .filter(([, group]) => group.length >= min)
    .map(([playerId, group]) => ({ playerId, stats: aggregate(group) }))
    .filter((entry) => entry.stats.winRate !== null)
    .sort((a, b) => (b.stats.winRate ?? 0) - (a.stats.winRate ?? 0));

  const bestPartner = rankedPartners[0];
  if (bestPartner && rankedPartners.length >= 2) {
    push({
      id: `best-partner-${bestPartner.playerId}`,
      kind: 'OBSERVATION',
      sentiment: 'POSITIVE',
      title: `Your strongest partnership is with ${context.playerName(bestPartner.playerId)}.`,
      detail: `${bestPartner.stats.wins} wins from ${bestPartner.stats.matches} matches together (${formatRate(bestPartner.stats.winRate)}), the highest of your ${rankedPartners.length} regular partnerships.`,
      evidence: {
        partner: context.playerName(bestPartner.playerId),
        wins: bestPartner.stats.wins,
        matches: bestPartner.stats.matches,
        winRate: bestPartner.stats.winRate,
        partnershipsCompared: rankedPartners.length,
      },
      sampleSize: bestPartner.stats.matches,
    });
  }

  // --- Situational: first game, comebacks, clutch ---------------------------
  const situational = situationalAnalysis(ordered);
  if (
    situational.afterWinningFirstGame !== null &&
    situational.afterLosingFirstGame !== null &&
    situational.firstGames.won + situational.firstGames.lost >= min * 2
  ) {
    push({
      id: 'first-game-leverage',
      kind: 'INTERPRETATION',
      sentiment: 'NEUTRAL',
      title: `Winning the first game is worth ${round(situational.afterWinningFirstGame - situational.afterLosingFirstGame, 1)} points of win rate to you.`,
      detail: `You win ${formatRate(situational.afterWinningFirstGame)} of matches after taking the opening game, and ${formatRate(situational.afterLosingFirstGame)} after dropping it. Starting quickly appears to matter more than average for your results.`,
      evidence: {
        afterWinningFirstGame: situational.afterWinningFirstGame,
        afterLosingFirstGame: situational.afterLosingFirstGame,
        firstGamesWon: situational.firstGames.won,
        firstGamesLost: situational.firstGames.lost,
      },
      sampleSize: situational.firstGames.won + situational.firstGames.lost,
    });
  }

  if (situational.clutch.stats.matches >= min && situational.clutch.stats.winRate !== null) {
    const clutchGap =
      overall.winRate === null
        ? null
        : round(situational.clutch.stats.winRate - overall.winRate, 1);
    if (clutchGap !== null && Math.abs(clutchGap) >= 10) {
      push({
        id: 'clutch-performance',
        kind: 'INTERPRETATION',
        sentiment: clutchGap > 0 ? 'POSITIVE' : 'NEGATIVE',
        title:
          clutchGap > 0
            ? 'You outperform your average in tight matches.'
            : 'Tight matches have gone against you more often than average.',
        detail: `In matches where every game finished within ${situational.clutch.thresholdMargin} points you win ${formatRate(situational.clutch.stats.winRate)}, against ${formatRate(overall.winRate)} overall (${situational.clutch.stats.matches} such matches).`,
        evidence: {
          clutchWinRate: situational.clutch.stats.winRate,
          overallWinRate: overall.winRate,
          clutchMatches: situational.clutch.stats.matches,
          thresholdMargin: situational.clutch.thresholdMargin,
        },
        sampleSize: situational.clutch.stats.matches,
      });
    }
  }

  // --- Fatigue -------------------------------------------------------------
  const fatigue = fatigueAnalysis(ordered);
  if (fatigue.observation && fatigue.earlyVsLateWinRateDelta !== null) {
    const declining = fatigue.earlyVsLateWinRateDelta <= -10;
    push({
      id: 'session-fatigue',
      kind: 'INTERPRETATION',
      sentiment: declining ? 'NEGATIVE' : 'NEUTRAL',
      title: declining
        ? 'Your results appear to decline later in a session.'
        : 'Your results hold up through a session.',
      detail: fatigue.observation,
      evidence: {
        earlyVsLateWinRateDelta: fatigue.earlyVsLateWinRateDelta,
        bucketsCompared: fatigue.buckets.length,
      },
      sampleSize: ordered.length,
    });
  }

  // --- Venue outlier -------------------------------------------------------
  const venueGroups = breakdownByVenue(ordered);
  const rankedVenues = [...venueGroups.entries()]
    .filter(([venueId, group]) => venueId !== '' && group.length >= min)
    .map(([venueId, group]) => ({ venueId, stats: aggregate(group) }))
    .filter((entry) => entry.stats.winRate !== null);

  if (rankedVenues.length >= 2 && overall.winRate !== null) {
    const best = [...rankedVenues].sort(
      (a, b) => (b.stats.winRate ?? 0) - (a.stats.winRate ?? 0),
    )[0];
    if (best && (best.stats.winRate ?? 0) - overall.winRate >= 10) {
      push({
        id: `venue-strength-${best.venueId}`,
        kind: 'OBSERVATION',
        sentiment: 'POSITIVE',
        title: `You win more often at ${context.venueName(best.venueId)}.`,
        detail: `${formatRate(best.stats.winRate)} across ${best.stats.matches} matches there, against ${formatRate(overall.winRate)} overall. Who you tend to play at each venue is part of this.`,
        evidence: {
          venue: context.venueName(best.venueId),
          venueWinRate: best.stats.winRate,
          overallWinRate: overall.winRate,
          matches: best.stats.matches,
        },
        sampleSize: best.stats.matches,
      });
    }
  }

  // --- Margin trend over time ---------------------------------------------
  if (ordered.length >= min * 4) {
    const half = Math.floor(ordered.length / 2);
    const earlier = aggregate(ordered.slice(0, half));
    const later = aggregate(ordered.slice(half));
    if (earlier.averageWinningMargin !== null && later.averageWinningMargin !== null) {
      const delta = round(later.averageWinningMargin - earlier.averageWinningMargin, 2);
      if (Math.abs(delta) >= 1) {
        push({
          id: 'winning-margin-trend',
          kind: 'OBSERVATION',
          sentiment: delta > 0 ? 'POSITIVE' : 'NEGATIVE',
          title: `Your average winning margin has ${delta > 0 ? 'grown' : 'narrowed'} by ${Math.abs(delta)} points.`,
          detail: `${earlier.averageWinningMargin} points per won game across your earlier ${half} matches, ${later.averageWinningMargin} across the later ${ordered.length - half}.`,
          evidence: {
            earlierMargin: earlier.averageWinningMargin,
            laterMargin: later.averageWinningMargin,
            delta,
            matchesCompared: ordered.length,
          },
          sampleSize: ordered.length,
        });
      }
    }
  }

  // --- Inactivity ----------------------------------------------------------
  const lastMatch = ordered[ordered.length - 1];
  if (lastMatch) {
    const idleDays = daysBetween(lastMatch.playedAt, context.now);
    if (idleDays >= 14) {
      push({
        id: 'inactivity',
        kind: 'OBSERVATION',
        sentiment: 'NEUTRAL',
        title: `You have not recorded a match for ${idleDays} days.`,
        detail: `Your last recorded match was on ${lastMatch.playedAt.toISOString().slice(0, 10)}.`,
        evidence: { idleDays, lastPlayed: lastMatch.playedAt.toISOString() },
        sampleSize: 1,
      });
    }
  }

  // --- Recommendation ------------------------------------------------------
  const recommendation = buildRecommendation(ordered, situational, context);
  if (recommendation) push(recommendation);

  return insights;
}

/**
 * A single, clearly-labelled suggestion derived from the weakest measured area.
 * It never claims certainty and always names the number it is based on.
 */
function buildRecommendation(
  matches: readonly MatchRecord[],
  situational: ReturnType<typeof situationalAnalysis>,
  _context: InsightContext,
): Insight | null {
  const min = ANALYTICS_CONSTANTS.minMatchesForInsight;
  if (matches.length < min * 2) return null;

  const overall = aggregate(matches);
  if (overall.winRate === null) return null;

  const candidates: Array<{
    gap: number;
    title: string;
    detail: string;
    evidence: Record<string, number | string | null>;
  }> = [];

  if (situational.deciders.matches >= min && situational.deciders.winRate !== null) {
    candidates.push({
      gap: overall.winRate - situational.deciders.winRate,
      title: 'Deciding games look like your biggest opportunity.',
      detail: `You win ${formatRate(situational.deciders.winRate)} of matches that reach a decider, against ${formatRate(overall.winRate)} overall across ${situational.deciders.matches} such matches. Practising end-of-match routines — serve choice, rally patience at 15+ — targets exactly this gap.`,
      evidence: {
        deciderWinRate: situational.deciders.winRate,
        overallWinRate: overall.winRate,
        deciderMatches: situational.deciders.matches,
      },
    });
  }

  if (situational.clutch.stats.matches >= min && situational.clutch.stats.winRate !== null) {
    candidates.push({
      gap: overall.winRate - situational.clutch.stats.winRate,
      title: 'Close games look like your biggest opportunity.',
      detail: `In matches decided by ${situational.clutch.thresholdMargin} points or fewer per game you win ${formatRate(situational.clutch.stats.winRate)}, against ${formatRate(overall.winRate)} overall. Point-pressure drills from 18-all address this directly.`,
      evidence: {
        clutchWinRate: situational.clutch.stats.winRate,
        overallWinRate: overall.winRate,
        clutchMatches: situational.clutch.stats.matches,
      },
    });
  }

  if (situational.afterLosingFirstGame !== null && situational.firstGames.lost >= min) {
    candidates.push({
      gap: overall.winRate - situational.afterLosingFirstGame,
      title: 'Recovering from a lost opening game looks like your biggest opportunity.',
      detail: `You win ${formatRate(situational.afterLosingFirstGame)} of matches after dropping the first game, across ${situational.firstGames.lost} such matches. A fixed between-games reset routine is the usual lever here.`,
      evidence: {
        afterLosingFirstGame: situational.afterLosingFirstGame,
        overallWinRate: overall.winRate,
        firstGamesLost: situational.firstGames.lost,
      },
    });
  }

  const worst = candidates.sort((a, b) => b.gap - a.gap)[0];
  if (!worst || worst.gap < 5) return null;

  return {
    id: 'focus-recommendation',
    kind: 'RECOMMENDATION',
    sentiment: 'NEUTRAL',
    title: worst.title,
    detail: worst.detail,
    evidence: { ...worst.evidence, gapInPercentagePoints: round(worst.gap, 1) },
    sampleSize: matches.length,
  };
}

function sentimentFromWinRate(winRate: number | null): InsightSentiment {
  if (winRate === null) return 'NEUTRAL';
  if (winRate >= 60) return 'POSITIVE';
  if (winRate <= 40) return 'NEGATIVE';
  return 'NEUTRAL';
}

function formatRate(rate: number | null): string {
  return rate === null ? 'no recorded' : `${rate}%`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}
