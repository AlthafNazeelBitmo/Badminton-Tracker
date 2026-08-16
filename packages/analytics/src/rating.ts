import type { Discipline, RatingSummary } from '@badminton/contracts';
import type { MatchRecord } from './types';
import { byPlayedAtAscending } from './aggregate';
import { deriveMatch } from './derive';
import { clamp, round } from './math';

/**
 * Elo-style rating.
 *
 * IMPORTANT: this is an *estimated application rating* derived only from matches
 * recorded in this app. It is not a BWF ranking, a club grading, or any official
 * measure, and every surface that shows it must say so.
 *
 * Algorithm (standard Elo):
 *   expected = 1 / (1 + 10^((opponentRating − playerRating) / 400))
 *   delta    = K × (actual − expected)      actual ∈ {1, 0.5, 0}
 *
 * Doubles: a side's rating is the mean of its players' ratings, and each player on the
 * side receives the full delta. Averaging keeps a strong player from being dragged down
 * for partnering a weaker one more than the result justifies, while applying the full
 * delta keeps individual ratings responsive.
 *
 * Uncertainty: new players carry a provisional K-factor for their first
 * `provisionalMatches` matches so ratings converge quickly, then settle onto the stable
 * K. Deviation is a simple confidence proxy that shrinks with matches played; it is
 * reported alongside the rating rather than being folded into it.
 */
export interface RatingConfig {
  startingRating: number;
  kFactor: number;
  provisionalKFactor: number;
  provisionalMatches: number;
  minRating: number;
  maxRating: number;
  startingDeviation: number;
  minDeviation: number;
  deviationDecayPerMatch: number;
}

export const DEFAULT_RATING_CONFIG: RatingConfig = {
  startingRating: 1200,
  kFactor: 24,
  provisionalKFactor: 48,
  provisionalMatches: 10,
  minRating: 100,
  maxRating: 3500,
  startingDeviation: 350,
  minDeviation: 50,
  deviationDecayPerMatch: 12,
};

export const RATING_DISCLAIMER =
  'Estimated rating calculated from matches recorded in this app. It is not an official badminton ranking.';

export interface RatingState {
  rating: number;
  matches: number;
}

export interface RatingEvent {
  matchId: string;
  playedAt: Date;
  discipline: Discipline;
  ratingBefore: number;
  ratingAfter: number;
  delta: number;
  opponentRating: number;
  result: 'WIN' | 'LOSS' | 'DRAW';
  kFactor: number;
}

export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

function kFor(state: RatingState, config: RatingConfig): number {
  return state.matches < config.provisionalMatches ? config.provisionalKFactor : config.kFactor;
}

function actualScore(result: 'WIN' | 'LOSS' | 'DRAW'): number {
  if (result === 'WIN') return 1;
  if (result === 'LOSS') return 0;
  return 0.5;
}

/**
 * Replays a user's match history to produce their rating history and the final rating of
 * every player involved.
 *
 * Replaying from raw matches (rather than storing a running rating) means the whole
 * rating model can be re-tuned and recomputed without data loss — the same principle the
 * rest of the analytics engine follows.
 */
export function replayRatings(
  matches: readonly MatchRecord[],
  config: RatingConfig = DEFAULT_RATING_CONFIG,
): {
  events: RatingEvent[];
  userRating: RatingState;
  userRatingByDiscipline: Record<Discipline, RatingState>;
  playerRatings: Map<string, RatingState>;
} {
  const ordered = [...matches].sort(byPlayedAtAscending);

  const user: RatingState = { rating: config.startingRating, matches: 0 };
  const byDiscipline: Record<Discipline, RatingState> = {
    SINGLES: { rating: config.startingRating, matches: 0 },
    DOUBLES: { rating: config.startingRating, matches: 0 },
    MIXED_DOUBLES: { rating: config.startingRating, matches: 0 },
  };
  const players = new Map<string, RatingState>();

  const stateFor = (playerId: string): RatingState => {
    let state = players.get(playerId);
    if (!state) {
      state = { rating: config.startingRating, matches: 0 };
      players.set(playerId, state);
    }
    return state;
  };

  const events: RatingEvent[] = [];

  for (const match of ordered) {
    const derived = deriveMatch(match);
    const opponents = match.opponentIds.map(stateFor);
    const partners = match.partnerIds.map(stateFor);

    if (opponents.length === 0) continue;

    const opponentRating = average(opponents.map((state) => state.rating));
    const ownSideRating = average([user.rating, ...partners.map((state) => state.rating)]);

    const expected = expectedScore(ownSideRating, opponentRating);
    const actual = actualScore(derived.result);
    const k = kFor(user, config);
    const delta = k * (actual - expected);

    const before = user.rating;
    user.rating = clampRating(user.rating + delta, config);
    user.matches += 1;

    const disciplineState = byDiscipline[match.discipline];
    const disciplineDelta = kFor(disciplineState, config) * (actual - expected);
    disciplineState.rating = clampRating(disciplineState.rating + disciplineDelta, config);
    disciplineState.matches += 1;

    for (const partner of partners) {
      partner.rating = clampRating(partner.rating + kFor(partner, config) * (actual - expected), config);
      partner.matches += 1;
    }
    for (const opponent of opponents) {
      // The opposing side's outcome is the mirror image of the user's.
      opponent.rating = clampRating(
        opponent.rating + kFor(opponent, config) * ((1 - actual) - (1 - expected)),
        config,
      );
      opponent.matches += 1;
    }

    events.push({
      matchId: match.id,
      playedAt: match.playedAt,
      discipline: match.discipline,
      ratingBefore: round(before, 1),
      ratingAfter: round(user.rating, 1),
      delta: round(user.rating - before, 1),
      opponentRating: round(opponentRating, 1),
      result: derived.result,
      kFactor: k,
    });
  }

  return {
    events,
    userRating: { rating: round(user.rating, 1), matches: user.matches },
    userRatingByDiscipline: {
      SINGLES: roundState(byDiscipline.SINGLES),
      DOUBLES: roundState(byDiscipline.DOUBLES),
      MIXED_DOUBLES: roundState(byDiscipline.MIXED_DOUBLES),
    },
    playerRatings: new Map(
      [...players.entries()].map(([id, state]) => [id, roundState(state)]),
    ),
  };
}

/** Deviation as a confidence proxy: wide at first, narrowing as evidence accumulates. */
export function ratingDeviation(
  matchesRated: number,
  config: RatingConfig = DEFAULT_RATING_CONFIG,
): number {
  return Math.max(
    config.minDeviation,
    config.startingDeviation - matchesRated * config.deviationDecayPerMatch,
  );
}

export function summariseRating(
  replay: ReturnType<typeof replayRatings>,
  config: RatingConfig = DEFAULT_RATING_CONFIG,
): RatingSummary {
  const doubles = replay.userRatingByDiscipline.DOUBLES;
  const mixed = replay.userRatingByDiscipline.MIXED_DOUBLES;
  const combinedDoublesMatches = doubles.matches + mixed.matches;

  return {
    overall: replay.userRating.rating,
    singles: replay.userRatingByDiscipline.SINGLES.rating,
    doubles:
      combinedDoublesMatches === 0
        ? config.startingRating
        : round(
            (doubles.rating * doubles.matches + mixed.rating * mixed.matches) /
              combinedDoublesMatches,
            1,
          ),
    deviation: ratingDeviation(replay.userRating.matches, config),
    matchesRated: replay.userRating.matches,
    disclaimer: RATING_DISCLAIMER,
  };
}

function clampRating(value: number, config: RatingConfig): number {
  return clamp(value, config.minRating, config.maxRating);
}

function roundState(state: RatingState): RatingState {
  return { rating: round(state.rating, 1), matches: state.matches };
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}
