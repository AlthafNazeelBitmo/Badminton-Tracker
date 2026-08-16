import type { GoalMetric } from './enums';

/**
 * Achievements are defined declaratively so detection is a single generic pass over the
 * user's aggregate counters, rather than a pile of bespoke `if` statements. Adding a
 * badge means adding one row to this catalogue.
 */
export interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  /** Grouping used by the UI. */
  category: 'VOLUME' | 'PERFORMANCE' | 'STREAK' | 'MILESTONE' | 'SPECIAL';
  icon: string;
  /** Counter compared against `threshold`. */
  counter: AchievementCounter;
  threshold: number;
}

export type AchievementCounter =
  | 'matchesPlayed'
  | 'matchesWon'
  | 'gamesPlayed'
  | 'gamesWon'
  | 'pointsScored'
  | 'sessionsPlayed'
  | 'bestWinStreak'
  | 'comebacks'
  | 'perfectSessions'
  | 'distinctOpponents'
  | 'distinctVenues';

export type AchievementCounters = Record<AchievementCounter, number>;

export const ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    code: 'FIRST_MATCH',
    name: 'First Match',
    description: 'Record your first match.',
    category: 'MILESTONE',
    icon: '🏸',
    counter: 'matchesPlayed',
    threshold: 1,
  },
  {
    code: 'MATCHES_10',
    name: 'Getting Going',
    description: 'Play 10 matches.',
    category: 'VOLUME',
    icon: '🎯',
    counter: 'matchesPlayed',
    threshold: 10,
  },
  {
    code: 'MATCHES_50',
    name: 'Regular',
    description: 'Play 50 matches.',
    category: 'VOLUME',
    icon: '📅',
    counter: 'matchesPlayed',
    threshold: 50,
  },
  {
    code: 'MATCHES_100',
    name: 'Centurion',
    description: 'Play 100 matches.',
    category: 'VOLUME',
    icon: '💯',
    counter: 'matchesPlayed',
    threshold: 100,
  },
  {
    code: 'MATCHES_500',
    name: 'Court Fixture',
    description: 'Play 500 matches.',
    category: 'VOLUME',
    icon: '🏟️',
    counter: 'matchesPlayed',
    threshold: 500,
  },
  {
    code: 'WINS_1',
    name: 'First Win',
    description: 'Win your first match.',
    category: 'MILESTONE',
    icon: '✅',
    counter: 'matchesWon',
    threshold: 1,
  },
  {
    code: 'WINS_10',
    name: 'Ten Wins',
    description: 'Win 10 matches.',
    category: 'PERFORMANCE',
    icon: '🥉',
    counter: 'matchesWon',
    threshold: 10,
  },
  {
    code: 'WINS_50',
    name: 'Fifty Wins',
    description: 'Win 50 matches.',
    category: 'PERFORMANCE',
    icon: '🥈',
    counter: 'matchesWon',
    threshold: 50,
  },
  {
    code: 'WINS_100',
    name: 'Hundred Wins',
    description: 'Win 100 matches.',
    category: 'PERFORMANCE',
    icon: '🥇',
    counter: 'matchesWon',
    threshold: 100,
  },
  {
    code: 'GAMES_100',
    name: 'Hundred Games',
    description: 'Play 100 games.',
    category: 'VOLUME',
    icon: '🎮',
    counter: 'gamesPlayed',
    threshold: 100,
  },
  {
    code: 'GAMES_WON_100',
    name: 'Game Collector',
    description: 'Win 100 games.',
    category: 'PERFORMANCE',
    icon: '📈',
    counter: 'gamesWon',
    threshold: 100,
  },
  {
    code: 'POINTS_1000',
    name: 'Thousand Points',
    description: 'Score 1,000 points.',
    category: 'VOLUME',
    icon: '🔢',
    counter: 'pointsScored',
    threshold: 1000,
  },
  {
    code: 'POINTS_10000',
    name: 'Ten Thousand Points',
    description: 'Score 10,000 points.',
    category: 'VOLUME',
    icon: '🧮',
    counter: 'pointsScored',
    threshold: 10000,
  },
  {
    code: 'SESSIONS_10',
    name: 'Ten Sessions',
    description: 'Record 10 sessions.',
    category: 'VOLUME',
    icon: '🗓️',
    counter: 'sessionsPlayed',
    threshold: 10,
  },
  {
    code: 'SESSIONS_100',
    name: 'Hundred Sessions',
    description: 'Record 100 sessions.',
    category: 'VOLUME',
    icon: '📚',
    counter: 'sessionsPlayed',
    threshold: 100,
  },
  {
    code: 'STREAK_3',
    name: 'On a Roll',
    description: 'Win 3 matches in a row.',
    category: 'STREAK',
    icon: '🔥',
    counter: 'bestWinStreak',
    threshold: 3,
  },
  {
    code: 'STREAK_5',
    name: 'Five in a Row',
    description: 'Win 5 matches in a row.',
    category: 'STREAK',
    icon: '🔥',
    counter: 'bestWinStreak',
    threshold: 5,
  },
  {
    code: 'STREAK_10',
    name: 'Unstoppable',
    description: 'Win 10 matches in a row.',
    category: 'STREAK',
    icon: '⚡',
    counter: 'bestWinStreak',
    threshold: 10,
  },
  {
    code: 'COMEBACK_1',
    name: 'Never Say Die',
    description: 'Win a match after losing the first game.',
    category: 'SPECIAL',
    icon: '↩️',
    counter: 'comebacks',
    threshold: 1,
  },
  {
    code: 'COMEBACK_10',
    name: 'Comeback King',
    description: 'Complete 10 comebacks.',
    category: 'SPECIAL',
    icon: '👑',
    counter: 'comebacks',
    threshold: 10,
  },
  {
    code: 'PERFECT_SESSION',
    name: 'Perfect Session',
    description: 'Win every match in a session of 3 or more.',
    category: 'SPECIAL',
    icon: '🌟',
    counter: 'perfectSessions',
    threshold: 1,
  },
  {
    code: 'OPPONENTS_10',
    name: 'Well Connected',
    description: 'Play against 10 different opponents.',
    category: 'SPECIAL',
    icon: '🤝',
    counter: 'distinctOpponents',
    threshold: 10,
  },
  {
    code: 'VENUES_5',
    name: 'Well Travelled',
    description: 'Play at 5 different venues.',
    category: 'SPECIAL',
    icon: '📍',
    counter: 'distinctVenues',
    threshold: 5,
  },
] as const;

export const ACHIEVEMENTS_BY_CODE: ReadonlyMap<string, AchievementDefinition> = new Map(
  ACHIEVEMENTS.map((achievement) => [achievement.code, achievement]),
);

export interface AchievementView extends AchievementDefinition {
  unlocked: boolean;
  unlockedAt: string | null;
  progress: number;
  percentComplete: number;
}

/** Counters that also back goal metrics, kept aligned deliberately. */
export const GOAL_METRIC_TO_COUNTER: Partial<Record<GoalMetric, AchievementCounter>> = {
  MATCHES_PLAYED: 'matchesPlayed',
  MATCHES_WON: 'matchesWon',
  SESSIONS_PLAYED: 'sessionsPlayed',
  WIN_STREAK: 'bestWinStreak',
};
