import { z } from 'zod';
import {
  DISCIPLINES,
  MATCH_RESULTS,
  PERFORMANCE_TAGS,
  PLAYERS_PER_SIDE,
  SESSION_TYPES,
  type Discipline,
} from './enums';
import {
  isoDateSchema,
  optionalNotes,
  paginationSchema,
  ratingScaleSchema,
  trimmedString,
  uuidSchema,
} from './common';
import { scoringRulesSchema } from './auth';
import { playerRefSchema } from './players';
import type { ScoringRules } from './scoring';

export const gameScoreSchema = z.object({
  myScore: z.number().int().min(0).max(200),
  opponentScore: z.number().int().min(0).max(200),
});
export type GameScoreInput = z.infer<typeof gameScoreSchema>;

/**
 * Inline session creation for quick entry: rather than forcing the user to create a
 * session first, a match may carry the minimal description of the session it belongs
 * to. The API reuses an existing session for the same day/venue when one exists.
 */
export const inlineSessionSchema = z.object({
  date: isoDateSchema,
  venueId: uuidSchema.nullable().optional(),
  venueName: trimmedString(1, 120).optional(),
  sessionType: z.enum(SESSION_TYPES).default('CASUAL'),
  /**
   * Client-assigned id, for a session created offline. Ignored when an existing session
   * for the same day and venue is reused, which is the more useful behaviour: two matches
   * on the same evening belong to one session.
   */
  id: uuidSchema.optional(),
});
export type InlineSessionInput = z.infer<typeof inlineSessionSchema>;

const matchCoreSchema = z.object({
  discipline: z.enum(DISCIPLINES),
  playedAt: isoDateSchema.optional(),
  scoring: scoringRulesSchema.optional(),
  /** Team-mates on the user's side. Empty for singles, one entry for doubles. */
  partners: z.array(playerRefSchema).max(3).default([]),
  /** The opposing side. One entry for singles, two for doubles. */
  opponents: z.array(playerRefSchema).min(1).max(3),
  games: z.array(gameScoreSchema).min(1).max(9),
  durationSeconds: z
    .number()
    .int()
    .min(0)
    .max(60 * 60 * 12)
    .nullable()
    .optional(),
  difficulty: ratingScaleSchema.nullable().optional(),
  energyLevel: ratingScaleSchema.nullable().optional(),
  confidence: ratingScaleSchema.nullable().optional(),
  feeling: ratingScaleSchema.nullable().optional(),
  tags: z.array(z.enum(PERFORMANCE_TAGS)).max(PERFORMANCE_TAGS.length).default([]),
  notes: optionalNotes,
});

/** Side sizes must match the discipline: singles is 1v1, both doubles formats are 2v2. */
const hasCorrectPartnerCount = (value: { discipline: Discipline; partners: unknown[] }) =>
  value.partners.length === PLAYERS_PER_SIDE[value.discipline] - 1;

const hasCorrectOpponentCount = (value: { discipline: Discipline; opponents: unknown[] }) =>
  value.opponents.length === PLAYERS_PER_SIDE[value.discipline];

const PARTNER_COUNT_ERROR = {
  message: 'The number of partners does not match the discipline.',
  path: ['partners'],
};
const OPPONENT_COUNT_ERROR = {
  message: 'The number of opponents does not match the discipline.',
  path: ['opponents'],
};

export const createMatchSchema = matchCoreSchema
  .extend({
    sessionId: uuidSchema.optional(),
    session: inlineSessionSchema.optional(),
    /**
     * Client-assigned id, for a match recorded offline.
     *
     * The offline client stores the match locally under this id and queues the request.
     * Were the server to assign its own instead, the next sync would return the same
     * match under a different id and the device would show it twice — once as its local
     * copy and once as the server's. Adopting the client's id makes the two the same row.
     *
     * Rejected with a conflict if already taken, which for a version-4 UUID means the
     * client is retrying without an idempotency key rather than that ids have collided.
     */
    id: uuidSchema.optional(),
  })
  .refine(hasCorrectPartnerCount, PARTNER_COUNT_ERROR)
  .refine(hasCorrectOpponentCount, OPPONENT_COUNT_ERROR)
  .refine((value) => Boolean(value.sessionId) !== Boolean(value.session), {
    message: 'Provide either an existing sessionId or an inline session description.',
    path: ['sessionId'],
  });
export type CreateMatchInput = z.infer<typeof createMatchSchema>;

export const updateMatchSchema = matchCoreSchema
  .extend({ sessionId: uuidSchema.optional() })
  .refine(hasCorrectPartnerCount, PARTNER_COUNT_ERROR)
  .refine(hasCorrectOpponentCount, OPPONENT_COUNT_ERROR);
export type UpdateMatchInput = z.infer<typeof updateMatchSchema>;

export const listMatchesSchema = paginationSchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  discipline: z.enum(DISCIPLINES).optional(),
  result: z.enum(MATCH_RESULTS).optional(),
  sessionId: uuidSchema.optional(),
  venueId: uuidSchema.optional(),
  opponentId: uuidSchema.optional(),
  partnerId: uuidSchema.optional(),
  tag: z.enum(PERFORMANCE_TAGS).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  search: z.string().trim().max(120).optional(),
  sort: z
    .enum(['NEWEST', 'OLDEST', 'BIGGEST_WIN', 'CLOSEST', 'LONGEST', 'HIGHEST_SCORING'])
    .default('NEWEST'),
});
export type ListMatchesQuery = z.infer<typeof listMatchesSchema>;

export interface GameView {
  id: string;
  gameNumber: number;
  myScore: number;
  opponentScore: number;
  result: 'WIN' | 'LOSS' | 'DRAW';
  margin: number;
}

export interface MatchParticipantView {
  playerId: string;
  name: string;
  nickname: string | null;
  avatarUrl: string | null;
  side: 'HOME' | 'AWAY';
  isSelf: boolean;
}

/** Derived per-match numbers. Always computed from games; never user-supplied. */
export interface MatchDerived {
  result: (typeof MATCH_RESULTS)[number];
  gamesWon: number;
  gamesLost: number;
  pointsScored: number;
  pointsConceded: number;
  pointDifferential: number;
  averagePointsPerGame: number;
  margin: number;
  /** True when the first game was lost but the match was won. */
  isComeback: boolean;
  /** True when the first game was won but the match was lost. */
  isCollapse: boolean;
  /** Decided in the final possible game of the format. */
  wentToDecider: boolean;
  /** Every game decided by at most `clutchMargin` points. */
  isClutch: boolean;
  /** Won or lost by a wide margin in every game. */
  isBlowout: boolean;
  longestGameMargin: number;
  closestGameMargin: number;
}

export interface MatchSummary {
  id: string;
  sessionId: string;
  playedAt: string;
  orderInSession: number;
  discipline: (typeof DISCIPLINES)[number];
  scoring: ScoringRules;
  durationSeconds: number | null;
  difficulty: number | null;
  energyLevel: number | null;
  confidence: number | null;
  feeling: number | null;
  notes: string | null;
  tags: Array<(typeof PERFORMANCE_TAGS)[number]>;
  venue: { id: string; name: string } | null;
  partners: MatchParticipantView[];
  opponents: MatchParticipantView[];
  games: GameView[];
  derived: MatchDerived;
  createdAt: string;
  updatedAt: string;
}

export interface MatchDetail extends MatchSummary {
  session: { id: string; date: string; sessionType: (typeof SESSION_TYPES)[number] };
  /** Data-backed observations about this specific match. */
  insights: string[];
  ratingChange: { before: number; after: number; delta: number } | null;
}
