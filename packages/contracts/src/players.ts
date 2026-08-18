import { z } from 'zod';
import { DOMINANT_HANDS, PLAYER_RELATIONSHIPS, PLAYING_LEVELS, PLAYING_STYLES } from './enums';
import { optionalNotes, paginationSchema, trimmedString, uuidSchema } from './common';

/**
 * A player is a person known to one user's address book. The same human appearing as
 * an opponent one week and a partner the next is a single Player row: the role is a
 * property of the match, never of the person.
 */
export const createPlayerSchema = z.object({
  name: trimmedString(1, 80),
  nickname: z.string().trim().max(40).nullable().optional(),
  relationship: z.enum(PLAYER_RELATIONSHIPS).default('OTHER'),
  playingLevel: z.enum(PLAYING_LEVELS).nullable().optional(),
  dominantHand: z.enum(DOMINANT_HANDS).default('UNKNOWN'),
  playingStyle: z.enum(PLAYING_STYLES).default('UNKNOWN'),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  notes: optionalNotes,
});
export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;

export const updatePlayerSchema = createPlayerSchema.partial();
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;

export const listPlayersSchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  relationship: z.enum(PLAYER_RELATIONSHIPS).optional(),
  sort: z.enum(['NAME', 'RECENT', 'MOST_PLAYED']).default('RECENT'),
  includeSelf: z.coerce.boolean().default(false),
});
export type ListPlayersQuery = z.infer<typeof listPlayersSchema>;

/**
 * Reference to a player during fast match entry: either an existing id, or a name that
 * the API resolves case-insensitively and creates on demand. This is what makes
 * "played John & Ahmed" a single request.
 *
 * `id` exists for offline clients. A phone with no signal has to name a brand-new
 * opponent *and* reference them from the match in the same breath, which it cannot do if
 * the id only arrives with the server's reply. So it assigns one and the server adopts
 * it, and the ids agree from the outset with nothing to renumber later.
 *
 * The server may still decline to use it — if the name already belongs to someone, that
 * existing player wins, because two records for one person would split every statistic
 * about them. The client finds out on the next sync and reconciles.
 */
export const playerRefSchema = z
  .object({
    playerId: uuidSchema.optional(),
    name: trimmedString(1, 80).optional(),
    id: uuidSchema.optional(),
  })
  .refine((value) => Boolean(value.playerId) !== Boolean(value.name), {
    message: 'Provide either an existing playerId or a name, not both.',
  })
  .refine((value) => !(value.id && value.playerId), {
    message: 'A client-assigned id applies only when creating a player from a name.',
    path: ['id'],
  });
export type PlayerRef = z.infer<typeof playerRefSchema>;

export interface PlayerSummary {
  id: string;
  name: string;
  nickname: string | null;
  relationship: (typeof PLAYER_RELATIONSHIPS)[number];
  playingLevel: (typeof PLAYING_LEVELS)[number] | null;
  dominantHand: (typeof DOMINANT_HANDS)[number];
  playingStyle: (typeof PLAYING_STYLES)[number];
  avatarUrl: string | null;
  notes: string | null;
  isSelf: boolean;
  /** Estimated rating maintained by the platform; not an official ranking. */
  rating: number;
  ratingDeviation: number;
  matchesPlayed: number;
  lastPlayedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
