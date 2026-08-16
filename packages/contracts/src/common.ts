import { z } from 'zod';
import { DATE_RANGE_PRESETS, DISCIPLINES, MATCH_RESULTS, PERFORMANCE_TAGS, SESSION_TYPES } from './enums';

export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

export const uuidSchema = z.string().uuid('Must be a valid identifier.');

/** Accepts `2026-08-16` or a full ISO timestamp; always yields a `Date`. */
export const isoDateSchema = z.coerce.date({
  errorMap: () => ({ message: 'Must be a valid ISO date.' }),
});

export const trimmedString = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(min).max(max));

export const optionalNotes = z
  .string()
  .max(4000, 'Notes are limited to 4000 characters.')
  .trim()
  .optional()
  .nullable();

/** 1–5 subjective self-assessment scale used for difficulty, energy, confidence and feeling. */
export const ratingScaleSchema = z.number().int().min(1).max(5);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/** Shape of every error the API returns. Never leaks internals. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  /** Field-level validation problems, keyed by dotted path. */
  details?: Array<{ path: string; message: string; code?: string }>;
  requestId: string;
  timestamp: string;
}

/**
 * Global analytics filter. Every analytics endpoint accepts the same query shape so the
 * dashboard's filter bar works consistently across pages.
 */
export const analyticsFilterSchema = z
  .object({
    preset: z.enum(DATE_RANGE_PRESETS).default('ALL_TIME'),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    discipline: z.enum(DISCIPLINES).optional(),
    sessionType: z.enum(SESSION_TYPES).optional(),
    venueId: uuidSchema.optional(),
    opponentId: uuidSchema.optional(),
    partnerId: uuidSchema.optional(),
    result: z.enum(MATCH_RESULTS).optional(),
    difficulty: z.coerce.number().int().min(1).max(5).optional(),
    tag: z.enum(PERFORMANCE_TAGS).optional(),
    /** Client IANA time zone, so day/week/month buckets match the user's calendar. */
    timeZone: z.string().min(1).max(64).default('UTC'),
  })
  .refine((value) => value.preset !== 'CUSTOM' || (value.from != null && value.to != null), {
    message: 'A custom range requires both `from` and `to`.',
    path: ['preset'],
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: '`from` must not be after `to`.',
    path: ['from'],
  });

export type AnalyticsFilter = z.infer<typeof analyticsFilterSchema>;

export const granularityQuerySchema = z.object({
  granularity: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']).default('MONTH'),
});

export interface DateRange {
  from: Date | null;
  to: Date | null;
}
