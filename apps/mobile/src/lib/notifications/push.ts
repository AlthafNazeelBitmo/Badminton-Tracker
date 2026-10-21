import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Localization from 'expo-localization';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
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
 * Whether the person switched reminders on *in this app*.
 *
 * Deliberately separate from the operating system's permission. Switching reminders off
 * here leaves that permission granted, so a switch that read the permission would show
 * "on" again next time — and the launch-time registration would quietly send the token
 * back to the server, undoing the choice. The permission says the app *may* notify; this
 * says the person *wants* it to.
 */
const PUSH_PREFERENCE_KEY = 'badminton.pushEnabled';

export async function isPushPreferred(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PUSH_PREFERENCE_KEY)) === 'true';
}

/**
 * The EAS project id, or null while it is still the placeholder in `app.config.ts`.
 *
 * Expo issues push tokens per project. With the all-zero placeholder the request throws,
 * so it is treated as "not configured" — a build without a project simply has no push.
 */
function easProjectId(): string | null {
  const id = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)) return null;
  return id;
}

export type EnablePushResult =
  | 'enabled'
  /** The person refused, now or earlier. On iOS only the Settings app can undo that. */
  | 'denied'
  /** A simulator, or a build with no EAS project configured. Nothing the person can fix. */
  | 'unavailable';

/**
 * Asks for permission, fetches a token and registers it.
 *
 * Only call this from an explicit action — the settings switch. On iOS the system prompt
 * can be shown once, and a refusal there can only be undone in Settings.
 */
export async function enablePush(): Promise<EnablePushResult> {
  // A simulator has no push service; asking produces an error rather than a prompt.
  if (!Device.isDevice || !easProjectId()) return 'unavailable';

  const existing = await Notifications.getPermissionsAsync();
  const granted =
    existing.status === 'granted' ||
    (existing.canAskAgain && (await Notifications.requestPermissionsAsync()).status === 'granted');
  if (!granted) return 'denied';

  const token = await fetchToken();
  if (!token) return 'unavailable';

  await registerDevice(token);
  await SecureStore.setItemAsync(PUSH_PREFERENCE_KEY, 'true');
  return 'enabled';
}

/**
 * Re-sends this device's registration on launch, without ever prompting.
 *
 * The token goes up only if the person switched reminders on *and* the permission is
 * still granted — they may have revoked it in system settings since. Otherwise the
 * device registers with no token, which also clears one left over from before.
 */
export async function refreshRegistration(): Promise<void> {
  const wanted = await isPushPreferred();
  const permitted = (await currentPermission()) === 'granted';
  const token =
    wanted && permitted && Device.isDevice && easProjectId() ? await fetchToken() : null;
  await registerDevice(token);
}

async function fetchToken(): Promise<string | null> {
  const projectId = easProjectId();
  if (!projectId) return null;

  try {
    if (Platform.OS === 'android') {
      // Android requires a channel before anything can be delivered. Without one the
      // notification is dropped silently, which is a maddening thing to debug. The name
      // matches the `channelId` the API sends.
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
      });
    }

    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    // No network, or Expo unreachable. The next launch tries again.
    return null;
  }
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
 * Switches reminders off, and keeps them off.
 *
 * The preference is recorded first, so even if the request below fails offline the next
 * launch registers without a token and the server stops sending. Deleting the whole
 * device record instead would also remove it from the list of signed-in devices, which
 * is not what "stop notifying me" means.
 */
export async function disablePush(): Promise<void> {
  await SecureStore.setItemAsync(PUSH_PREFERENCE_KEY, 'false');
  await registerDevice(null);
}
