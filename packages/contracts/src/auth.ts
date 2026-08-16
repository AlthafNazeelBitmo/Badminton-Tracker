import { z } from 'zod';
import { DOMINANT_HANDS, DISCIPLINES, PLAYING_LEVELS, PLAYING_STYLES, USER_ROLES, VISIBILITIES } from './enums';
import { trimmedString } from './common';
import { DEFAULT_SCORING_RULES } from './scoring';

/**
 * Password policy. Deliberately length-first rather than composition-first, matching
 * current NIST guidance: long passphrases beat mandatory symbol soup.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`)
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
    message: 'Password must contain at least one letter and one number.',
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Must be a valid email address.')
  .max(254);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: trimmedString(1, 80),
  timeZone: z.string().min(1).max(64).default('UTC'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({ email: emailSchema });
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const scoringRulesSchema = z.object({
  pointsToWin: z.number().int().min(1).max(100),
  winBy: z.number().int().min(1).max(10),
  maxPoints: z.number().int().min(1).max(200),
  bestOf: z.number().int().min(1).max(9),
});

export const updateProfileSchema = z.object({
  name: trimmedString(1, 80).optional(),
  timeZone: z.string().min(1).max(64).optional(),
  locale: z.string().min(2).max(10).optional(),
  dateOfBirth: z.coerce.date().nullable().optional(),
  playingLevel: z.enum(PLAYING_LEVELS).optional(),
  preferredDiscipline: z.enum(DISCIPLINES).nullable().optional(),
  dominantHand: z.enum(DOMINANT_HANDS).optional(),
  playingStyle: z.enum(PLAYING_STYLES).optional(),
  preferredRacket: z.string().max(120).nullable().optional(),
  preferredStrings: z.string().max(120).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  defaultScoring: scoringRulesSchema.optional(),
  defaultVisibility: z.enum(VISIBILITIES).optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const DEFAULT_PROFILE_SCORING = DEFAULT_SCORING_RULES;

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: (typeof USER_ROLES)[number];
  emailVerified: boolean;
  timeZone: string;
}

export interface SessionResponse {
  user: AuthenticatedUser;
  /** Seconds until the access token expires; the client refreshes shortly before. */
  expiresIn: number;
}
