import type { Discipline, PerformanceTag, PeriodGranularity } from './enums';

/**
 * The canonical aggregate. Every breakdown in the platform — by opponent, partner,
 * venue, discipline, month, session — returns this same block, so one chart component
 * and one table component render all of them.
 *
 * Rates are percentages in the range 0–100 and are `null` when the denominator is zero,
 * never 0. A player with no matches has an *unknown* win rate, not a 0% win rate.
 */
export interface PerformanceStats {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gameWinRate: number | null;
  pointsScored: number;
  pointsConceded: number;
  pointWinRate: number | null;
  pointDifferential: number;
  averagePointsScoredPerGame: number | null;
  averagePointsConcededPerGame: number | null;
  averageWinningMargin: number | null;
  averageLosingMargin: number | null;
  playingSeconds: number;
  averageMatchSeconds: number | null;
}

export interface StreakInfo {
  currentWinStreak: number;
  currentLossStreak: number;
  bestWinStreak: number;
  worstLossStreak: number;
  /** Signed convenience value: positive for a winning run, negative for a losing run. */
  current: number;
  lastResultAt: string | null;
}

export interface OverviewResponse {
  stats: PerformanceStats;
  streaks: StreakInfo;
  sessions: number;
  distinctOpponents: number;
  distinctPartners: number;
  distinctVenues: number;
  firstMatchAt: string | null;
  lastMatchAt: string | null;
  /** Same window immediately before the selected one, for "vs previous period" deltas. */
  previousPeriod: PerformanceStats | null;
  rating: RatingSummary;
}

export interface TrendPoint {
  /** ISO date of the bucket start, in the requesting user's time zone. */
  periodStart: string;
  label: string;
  stats: PerformanceStats;
}

export interface TrendResponse {
  granularity: PeriodGranularity;
  points: TrendPoint[];
  /** Least-squares slope of win rate per bucket; null when fewer than 3 buckets. */
  winRateTrendPerPeriod: number | null;
}

export interface BreakdownEntry<TSubject> {
  subject: TSubject;
  stats: PerformanceStats;
  streaks: StreakInfo;
  lastPlayedAt: string | null;
  firstPlayedAt: string | null;
  bestResult: { matchId: string; playedAt: string; score: string; margin: number } | null;
  worstResult: { matchId: string; playedAt: string; score: string; margin: number } | null;
}

export interface PlayerSubject {
  id: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  rating: number;
}

export interface VenueSubject {
  id: string | null;
  name: string;
  city: string | null;
}

export type OpponentBreakdown = BreakdownEntry<PlayerSubject>;
export type PartnerBreakdown = BreakdownEntry<PlayerSubject>;
export type VenueBreakdown = BreakdownEntry<VenueSubject> & {
  singles: PerformanceStats;
  doubles: PerformanceStats;
};
export type DisciplineBreakdown = BreakdownEntry<{ discipline: Discipline }>;

/** Performance in tight games versus dominant ones. */
export interface SituationalResponse {
  clutch: { thresholdMargin: number; stats: PerformanceStats };
  blowout: { thresholdMargin: number; stats: PerformanceStats };
  deciders: PerformanceStats;
  firstGames: { won: number; lost: number; winRate: number | null };
  comebacks: number;
  collapses: number;
  /** Win rate when the first game was won, and when it was lost. */
  afterWinningFirstGame: number | null;
  afterLosingFirstGame: number | null;
  consistency: ConsistencyScore;
}

export interface ConsistencyScore {
  /** 0–100. Higher means more repeatable per-game point margins. See docs/analytics.md. */
  score: number | null;
  standardDeviation: number | null;
  meanMargin: number | null;
  sampleSize: number;
  method: string;
}

/** Performance by position within a session, used for the fatigue view. */
export interface FatigueResponse {
  buckets: Array<{
    matchNumber: number;
    stats: PerformanceStats;
    sessionsSampled: number;
  }>;
  /** Difference in win rate between the first third and last third of sessions. */
  earlyVsLateWinRateDelta: number | null;
  observation: string | null;
}

export interface HeatmapDay {
  date: string;
  sessions: number;
  matches: number;
  wins: number;
  losses: number;
}

export interface HeatmapResponse {
  from: string;
  to: string;
  days: HeatmapDay[];
  mostActiveWeekday: { weekday: number; sessions: number } | null;
  mostActiveMonth: { month: string; sessions: number } | null;
  averageSessionsPerWeek: number | null;
  longestActiveStreakDays: number;
}

export interface PersonalRecord {
  code: string;
  label: string;
  value: string;
  detail: string | null;
  matchId: string | null;
  sessionId: string | null;
  occurredAt: string | null;
}

export interface RatingSummary {
  overall: number;
  singles: number;
  doubles: number;
  /** Uncertainty; shrinks as more matches are recorded. */
  deviation: number;
  matchesRated: number;
  disclaimer: string;
}

export interface RatingHistoryPoint {
  matchId: string;
  playedAt: string;
  discipline: Discipline;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  opponentRating: number;
  result: 'WIN' | 'LOSS' | 'DRAW';
}

export type InsightKind = 'OBSERVATION' | 'INTERPRETATION' | 'RECOMMENDATION';
export type InsightSentiment = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';

/**
 * A single generated insight. `kind` keeps the three levels of claim strictly separated:
 * what the data says, what it might mean, and what to consider doing. `evidence` carries
 * the exact numbers behind the sentence so nothing is unverifiable.
 */
export interface Insight {
  id: string;
  kind: InsightKind;
  sentiment: InsightSentiment;
  title: string;
  detail: string;
  evidence: Record<string, number | string | null>;
  /** Minimum sample size this insight required before it was allowed to fire. */
  sampleSize: number;
}

export interface TagCorrelation {
  tag: PerformanceTag;
  matches: number;
  wins: number;
  winRate: number | null;
  /** Win rate with this tag minus overall win rate, in percentage points. */
  winRateDelta: number | null;
}

export interface PerformanceReport {
  generatedAt: string;
  period: { from: string | null; to: string | null; label: string };
  stats: PerformanceStats;
  streaks: StreakInfo;
  rating: RatingSummary;
  bestOpponent: { name: string; winRate: number | null; matches: number } | null;
  toughestOpponent: { name: string; winRate: number | null; matches: number } | null;
  bestPartner: { name: string; winRate: number | null; matches: number } | null;
  bestVenue: { name: string; winRate: number | null; matches: number } | null;
  disciplines: DisciplineBreakdown[];
  monthlyTrend: TrendPoint[];
  records: PersonalRecord[];
  insights: Insight[];
}

export interface SearchResult {
  players: Array<{ id: string; name: string; subtitle: string }>;
  venues: Array<{ id: string; name: string; subtitle: string }>;
  sessions: Array<{ id: string; date: string; subtitle: string }>;
  matches: Array<{ id: string; playedAt: string; subtitle: string }>;
}
