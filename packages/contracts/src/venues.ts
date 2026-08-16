import { z } from 'zod';
import { optionalNotes, paginationSchema, trimmedString } from './common';

export const createVenueSchema = z.object({
  name: trimmedString(1, 120),
  location: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  country: z
    .string()
    .trim()
    .length(2, 'Use a two-letter ISO country code.')
    .toUpperCase()
    .nullable()
    .optional(),
  isIndoor: z.boolean().default(true),
  courtCount: z.number().int().min(1).max(200).nullable().optional(),
  notes: optionalNotes,
  isFavourite: z.boolean().default(false),
});
export type CreateVenueInput = z.infer<typeof createVenueSchema>;

export const updateVenueSchema = createVenueSchema.partial();
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>;

export const listVenuesSchema = paginationSchema.extend({
  search: z.string().trim().max(120).optional(),
  sort: z.enum(['NAME', 'RECENT', 'MOST_PLAYED']).default('RECENT'),
});
export type ListVenuesQuery = z.infer<typeof listVenuesSchema>;

export interface VenueSummary {
  id: string;
  name: string;
  location: string | null;
  city: string | null;
  country: string | null;
  isIndoor: boolean;
  courtCount: number | null;
  notes: string | null;
  isFavourite: boolean;
  sessionCount: number;
  lastPlayedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
