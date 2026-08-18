import { z } from 'zod';
import { trimmedString } from './common';

export const DEVICE_PLATFORMS = ['IOS', 'ANDROID', 'WEB'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * Device registration.
 *
 * `installationId` is generated once by the client and kept in secure storage. It
 * identifies the installation rather than the hardware: reinstalling produces a new id,
 * so an uninstalled app does not keep receiving notifications through a token the new
 * install would never see.
 *
 * `pushToken` is nullable throughout. Declining notification permission is a normal
 * outcome, not an error, and the rest of the app must work identically without it.
 */
export const registerDeviceSchema = z.object({
  installationId: trimmedString(8, 128),
  platform: z.enum(DEVICE_PLATFORMS),
  pushToken: z.string().max(255).nullable().optional(),
  appVersion: z.string().max(32).nullable().optional(),
  osVersion: z.string().max(64).nullable().optional(),
  deviceName: z.string().max(120).nullable().optional(),
  locale: z.string().max(16).nullable().optional(),
  timeZone: z.string().max(64).nullable().optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export interface DeviceSummary {
  id: string;
  platform: DevicePlatform;
  deviceName: string | null;
  appVersion: string | null;
  pushEnabled: boolean;
  lastSeenAt: string;
  createdAt: string;
  /** True for the device making the request, so the UI can label it. */
  isCurrent: boolean;
}

export const updateNotificationPreferencesSchema = z.object({
  streaks: z.boolean().optional(),
  milestones: z.boolean().optional(),
  goalDeadlines: z.boolean().optional(),
  inactivityReminders: z.boolean().optional(),
  achievements: z.boolean().optional(),
  /** Local hour (0–23) after which notifications are held until morning. */
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
});
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

export interface NotificationPreferences {
  streaks: boolean;
  milestones: boolean;
  goalDeadlines: boolean;
  inactivityReminders: boolean;
  achievements: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  streaks: true,
  milestones: true,
  goalDeadlines: true,
  inactivityReminders: false,
  achievements: true,
  quietHoursStart: 22,
  quietHoursEnd: 8,
};
