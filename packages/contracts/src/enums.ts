/**
 * Domain enumerations shared by the API, the database layer and the web client.
 *
 * These values are persisted in PostgreSQL as native enums (see `prisma/schema.prisma`).
 * Renaming a member is therefore a breaking database change and requires a migration.
 */

export const DISCIPLINES = ['SINGLES', 'DOUBLES', 'MIXED_DOUBLES'] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const SESSION_TYPES = [
  'TRAINING',
  'CASUAL',
  'COMPETITIVE',
  'TOURNAMENT',
  'COACHING',
  'OTHER',
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const MATCH_RESULTS = ['WIN', 'LOSS', 'DRAW'] as const;
/**
 * `DRAW` only occurs for unusual custom formats (e.g. an even number of games in a
 * "best of 2" social format). Standard badminton formats never produce it.
 */
export type MatchResult = (typeof MATCH_RESULTS)[number];

export const MATCH_SIDES = ['HOME', 'AWAY'] as const;
/**
 * `HOME` is always the side the owning user played on. This invariant keeps every
 * analytics query symmetrical and is enforced when a match is created.
 */
export type MatchSide = (typeof MATCH_SIDES)[number];

export const PLAYER_RELATIONSHIPS = [
  'SELF',
  'FRIEND',
  'REGULAR_OPPONENT',
  'REGULAR_PARTNER',
  'COACH',
  'OTHER',
] as const;
export type PlayerRelationship = (typeof PLAYER_RELATIONSHIPS)[number];

export const DOMINANT_HANDS = ['RIGHT', 'LEFT', 'AMBIDEXTROUS', 'UNKNOWN'] as const;
export type DominantHand = (typeof DOMINANT_HANDS)[number];

export const PLAYING_LEVELS = [
  'BEGINNER',
  'IMPROVER',
  'INTERMEDIATE',
  'ADVANCED',
  'COMPETITIVE',
  'ELITE',
] as const;
export type PlayingLevel = (typeof PLAYING_LEVELS)[number];

export const PLAYING_STYLES = [
  'ATTACKING',
  'DEFENSIVE',
  'ALL_ROUND',
  'DECEPTIVE',
  'FAST_FLAT',
  'UNKNOWN',
] as const;
export type PlayingStyle = (typeof PLAYING_STYLES)[number];

export const GOAL_METRICS = [
  'MATCHES_PLAYED',
  'MATCHES_WON',
  'SESSIONS_PLAYED',
  'WIN_RATE',
  'GAME_WIN_RATE',
  'POINT_DIFFERENTIAL',
  'WIN_STREAK',
  'PLAYING_MINUTES',
] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GOAL_STATUSES = ['ACTIVE', 'ACHIEVED', 'MISSED', 'ARCHIVED'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const VISIBILITIES = ['PRIVATE', 'FRIENDS', 'PUBLIC'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const NOTIFICATION_TYPES = [
  'STREAK',
  'MILESTONE',
  'GOAL_PROGRESS',
  'GOAL_DEADLINE',
  'INACTIVITY',
  'ACHIEVEMENT',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Post-match performance tags. Deliberately a closed vocabulary so that
 * tag/result correlations are computable; free-form thoughts belong in `notes`.
 */
export const PERFORMANCE_TAGS = [
  'STRONG_DEFENCE',
  'STRONG_ATTACK',
  'GOOD_NET_PLAY',
  'GOOD_SMASH',
  'GREAT_TEAMWORK',
  'POOR_SERVE',
  'POOR_RETURN',
  'POOR_POSITIONING',
  'UNFORCED_ERRORS',
  'COMMUNICATION_ISSUES',
  'FATIGUE',
  'NERVOUS',
] as const;
export type PerformanceTag = (typeof PERFORMANCE_TAGS)[number];

export const PERIOD_GRANULARITIES = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;
export type PeriodGranularity = (typeof PERIOD_GRANULARITIES)[number];

export const DATE_RANGE_PRESETS = [
  'TODAY',
  'THIS_WEEK',
  'THIS_MONTH',
  'LAST_30_DAYS',
  'LAST_90_DAYS',
  'LAST_180_DAYS',
  'THIS_YEAR',
  'LAST_YEAR',
  'ALL_TIME',
  'CUSTOM',
] as const;
export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

/** Human-readable labels. The web client owns presentation; these are the fallbacks. */
export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  SINGLES: 'Singles',
  DOUBLES: 'Doubles',
  MIXED_DOUBLES: 'Mixed doubles',
};

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  TRAINING: 'Training',
  CASUAL: 'Casual',
  COMPETITIVE: 'Competitive',
  TOURNAMENT: 'Tournament',
  COACHING: 'Coaching',
  OTHER: 'Other',
};

export const PERFORMANCE_TAG_LABELS: Record<PerformanceTag, string> = {
  STRONG_DEFENCE: 'Strong defence',
  STRONG_ATTACK: 'Strong attack',
  GOOD_NET_PLAY: 'Good net play',
  GOOD_SMASH: 'Good smash',
  GREAT_TEAMWORK: 'Great teamwork',
  POOR_SERVE: 'Poor serve',
  POOR_RETURN: 'Poor return',
  POOR_POSITIONING: 'Poor positioning',
  UNFORCED_ERRORS: 'Unforced errors',
  COMMUNICATION_ISSUES: 'Communication issues',
  FATIGUE: 'Fatigue',
  NERVOUS: 'Nervous',
};

export const GOAL_METRIC_LABELS: Record<GoalMetric, string> = {
  MATCHES_PLAYED: 'Matches played',
  MATCHES_WON: 'Matches won',
  SESSIONS_PLAYED: 'Sessions played',
  WIN_RATE: 'Win rate (%)',
  GAME_WIN_RATE: 'Game win rate (%)',
  POINT_DIFFERENTIAL: 'Point differential',
  WIN_STREAK: 'Win streak',
  PLAYING_MINUTES: 'Playing minutes',
};

/** Metrics expressed as percentages, used for progress formatting and validation. */
export const PERCENTAGE_GOAL_METRICS: readonly GoalMetric[] = ['WIN_RATE', 'GAME_WIN_RATE'];

/** Number of players per side for each discipline. */
export const PLAYERS_PER_SIDE: Record<Discipline, number> = {
  SINGLES: 1,
  DOUBLES: 2,
  MIXED_DOUBLES: 2,
};
