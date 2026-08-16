import { z } from 'zod';
import { SESSION_TYPES } from './enums';
import { isoDateSchema, optionalNotes, paginationSchema, uuidSchema } from './common';

/**
 * A session is one visit to a court: the container for the matches played that day.
 * `date` is a calendar date (no time component) so that "sessions per week" is stable
 * regardless of the client's clock; `startedAt`/`endedAt` carry the optional wall times.
 */
export const createSessionSchema = z
  .object({
    date: isoDateSchema,
    venueId: uuidSchema.nullable().optional(),
    sessionType: z.enum(SESSION_TYPES).default('CASUAL'),
    startedAt: isoDateSchema.nullable().optional(),
    endedAt: isoDateSchema.nullable().optional(),
    notes: optionalNotes,
  })
  .refine((value) => !value.startedAt || !value.endedAt || value.startedAt <= value.endedAt, {
    message: 'A session cannot end before it starts.',
    path: ['endedAt'],
  });
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const updateSessionSchema = z
  .object({
    date: isoDateSchema.optional(),
    venueId: uuidSchema.nullable().optional(),
    sessionType: z.enum(SESSION_TYPES).optional(),
    startedAt: isoDateSchema.nullable().optional(),
    endedAt: isoDateSchema.nullable().optional(),
    notes: optionalNotes,
  })
  .refine((value) => !value.startedAt || !value.endedAt || value.startedAt <= value.endedAt, {
    message: 'A session cannot end before it starts.',
    path: ['endedAt'],
  });
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

export const listSessionsSchema = paginationSchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  venueId: uuidSchema.optional(),
  sessionType: z.enum(SESSION_TYPES).optional(),
  sort: z.enum(['NEWEST', 'OLDEST', 'MOST_MATCHES']).default('NEWEST'),
});
export type ListSessionsQuery = z.infer<typeof listSessionsSchema>;

export interface SessionStats {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  gamesWon: number;
  gamesLost: number;
  pointsScored: number;
  pointsConceded: number;
  pointDifferential: number;
  /** Minutes derived from `startedAt`/`endedAt`, falling back to summed match durations. */
  durationMinutes: number | null;
  averageMatchMinutes: number | null;
}

export interface SessionSummary {
  id: string;
  date: string;
  sessionType: (typeof SESSION_TYPES)[number];
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  venue: { id: string; name: string; city: string | null } | null;
  stats: SessionStats;
  createdAt: string;
  updatedAt: string;
}
