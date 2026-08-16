import type {
  Discipline,
  PerformanceTag,
  ScoreLine,
  ScoringRules,
  SessionType,
} from '@badminton/contracts';

/**
 * The normalised view of a match that every analytics function consumes.
 *
 * This is deliberately a plain data shape with no Prisma or Nest types: the entire
 * analytics engine is a pure function of these records, which is what makes it
 * unit-testable without a database and recomputable whenever a formula changes.
 *
 * Scores are always written from the owning user's perspective (`myScore` is the score
 * of the side the user played on).
 */
export interface MatchRecord {
  id: string;
  sessionId: string;
  playedAt: Date;
  /** 1-based position of this match within its session. */
  orderInSession: number;
  discipline: Discipline;
  sessionType: SessionType;
  venueId: string | null;
  venueName: string | null;
  scoring: ScoringRules;
  durationSeconds: number | null;
  difficulty: number | null;
  tags: PerformanceTag[];
  /** Player ids on the user's side, excluding the user. */
  partnerIds: string[];
  /** Player ids on the opposing side. */
  opponentIds: string[];
  /** Games in the order they were played. */
  games: ScoreLine[];
}

export interface SessionRecord {
  id: string;
  date: Date;
  sessionType: SessionType;
  venueId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
}

/**
 * Thresholds that define the qualitative buckets. They live in one place so the
 * documentation, the API and the tests cannot drift apart.
 */
export const ANALYTICS_CONSTANTS = {
  /** A game decided by this margin or fewer is "clutch" (21-19, 22-20, 21-18). */
  clutchMargin: 3,
  /** A game decided by this margin or more is a "blowout" (21-10, 21-8). */
  blowoutMargin: 11,
  /** Minimum games before a consistency score is reported. */
  minGamesForConsistency: 5,
  /** Minimum matches before an opponent/partner/venue breakdown is treated as meaningful. */
  minMatchesForInsight: 5,
  /** Minimum sessions before the fatigue view reports an observation. */
  minSessionsForFatigue: 5,
  /**
   * Standard deviation of per-game margin at which the consistency score reaches 0.
   * Expressed in points; 21 means "as variable as a full game's worth of points".
   */
  consistencySigmaMax: 21,
  /** A session counts as "perfect" when every match was won and it contained at least this many. */
  perfectSessionMinMatches: 3,
} as const;

export type SeriesResult = 'WIN' | 'LOSS' | 'DRAW';
export type { ScoreLine, ScoringRules };
