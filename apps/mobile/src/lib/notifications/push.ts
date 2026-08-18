import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Localization from 'expo-localization';
import Constants from 'expo-constants';
import type { DeviceSummary, RegisterDeviceInput } from '@badminton/contracts';
import { request } from '../api/client';
import { getInstallationId } from '../sync/sync-state';

/**
 * Push notifications and device registration.
 *
 * The permission is not requested at launch. A prompt that arrives before anyone has
 * recorded a single match is asking to interrupt somebody about data they do not have
 * yet, and the usual answer is "no" — which on iOS is permanent unless they find the
 * setting themselves. It is asked for from the settings screen, where the person has
 * gone looking for it.
 *
 * The device is registered regardless of whether push is granted. Registration is also
 * what powers the list of signed-in devices, and a phone that declined notifications is
 * still a phone with a live session on it.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    // These are reminders about badminton, not alerts. Making a phone chime for one is
    // the kind of thing that gets an app's notifications turned off entirely.
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export type PushPermission = 'granted' | 'denied' | 'undetermined';

export async function currentPermission(): Promise<PushPermission> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Asks for permission and returns the resulting token, if any.
 *
 * Only call this from an explicit user action. On iOS the system prompt can be shown
 * once; a refusal there can only be undone in Settings, which nobody does.
 */
export async function requestPushToken(): Promise<string | null> {
  // A simulator has no push service, so asking produces an error rather than a prompt.
  if (!Device.isDevice) return null;

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.status === 'granted'
      ? true
      : existing.canAskAgain
        ? (await Notifications.requestPermissionsAsync()).status === 'granted'
        : false;

  if (!granted) return null;

  if (Platform.OS === 'android') {
    // Android requires a channel before anything can be delivered. Without one the
    // notification is dropped silently, which is a maddening thing to debug.
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return null;

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return token.data;
}

/**
 * Tells the API about this device.
 *
 * Called on every launch rather than once: the operating system rotates push tokens, and
 * a stale one fails silently — notifications simply stop arriving, with nothing anywhere
 * to say why.
 */
export async function registerDevice(pushToken?: string | null): Promise<DeviceSummary | null> {
  try {
    const input: RegisterDeviceInput = {
      installationId: await getInstallationId(),
      platform: Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'ANDROID' : 'WEB',
      pushToken: pushToken ?? null,
      appVersion: Application.nativeApplicationVersion ?? null,
      osVersion: Device.osVersion ?? null,
      deviceName: Device.deviceName ?? null,
      locale: Localization.getLocales()[0]?.languageTag ?? null,
      timeZone: Localization.getCalendars()[0]?.timeZone ?? null,
    };

    return await request<DeviceSummary>('/devices', { method: 'POST', body: input });
  } catch {
    // Bookkeeping, not a feature. Failing here must not stop the app starting, and the
    // next launch tries again.
    return null;
  }
}

export async function listDevices(): Promise<DeviceSummary[]> {
  return request<DeviceSummary[]>('/devices', {
    query: { installationId: await getInstallationId() },
  });
}

export async function forgetDevice(id: string): Promise<void> {
  await request(`/devices/${id}`, { method: 'DELETE' });
}

/**
 * Clears the push token from this device's registration.
 *
 * Used when notifications are switched off in the app. Deleting the whole device record
 * would also remove it from the list of signed-in devices, which is not what "stop
 * notifying me" means.
 */
export async function disablePush(): Promise<void> {
  await registerDevice(null);
}
