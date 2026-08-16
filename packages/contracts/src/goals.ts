import { z } from 'zod';
import { DISCIPLINES, GOAL_METRICS, GOAL_STATUSES, PERCENTAGE_GOAL_METRICS } from './enums';
import { isoDateSchema, optionalNotes, paginationSchema, trimmedString } from './common';

export const createGoalSchema = z
  .object({
    title: trimmedString(1, 120),
    metric: z.enum(GOAL_METRICS),
    targetValue: z.number().min(0).max(1_000_000),
    discipline: z.enum(DISCIPLINES).nullable().optional(),
    /** Progress is measured from this date; defaults to the creation date. */
    startsOn: isoDateSchema.optional(),
    deadline: isoDateSchema.nullable().optional(),
    notes: optionalNotes,
  })
  .refine(
    (value) =>
      !PERCENTAGE_GOAL_METRICS.includes(value.metric) ||
      (value.targetValue >= 0 && value.targetValue <= 100),
    { message: 'Percentage goals must target a value between 0 and 100.', path: ['targetValue'] },
  )
  .refine((value) => !value.deadline || !value.startsOn || value.deadline >= value.startsOn, {
    message: 'The deadline must be on or after the start date.',
    path: ['deadline'],
  });
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

export const updateGoalSchema = z.object({
  title: trimmedString(1, 120).optional(),
  targetValue: z.number().min(0).max(1_000_000).optional(),
  deadline: isoDateSchema.nullable().optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  notes: optionalNotes,
});
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

export const listGoalsSchema = paginationSchema.extend({
  status: z.enum(GOAL_STATUSES).optional(),
});
export type ListGoalsQuery = z.infer<typeof listGoalsSchema>;

export interface GoalProgress {
  id: string;
  title: string;
  metric: (typeof GOAL_METRICS)[number];
  discipline: (typeof DISCIPLINES)[number] | null;
  targetValue: number;
  currentValue: number;
  /** Clamped to 0–100 for display; `currentValue` carries the raw number. */
  percentComplete: number;
  status: (typeof GOAL_STATUSES)[number];
  startsOn: string;
  deadline: string | null;
  daysRemaining: number | null;
  /** Progress needed per remaining day to finish on time, when a deadline exists. */
  requiredDailyPace: number | null;
  achievedAt: string | null;
  notes: string | null;
}
