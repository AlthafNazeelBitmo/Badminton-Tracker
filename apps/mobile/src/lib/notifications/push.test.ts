import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { disablePush, enablePush, isPushPreferred, refreshRegistration } from './push';

jest.mock('../api/client', () => ({ request: jest.fn(async () => ({})) }));
jest.mock('../sync/sync-state', () => ({
  getInstallationId: jest.fn(async () => 'installation-test-0001'),
}));

import { request } from '../api/client';

/**
 * The two ways this went wrong before: switching reminders on failed silently in a build
 * without an EAS project, and switching them off did not survive a relaunch, because the
 * launch-time registration only looked at the system permission.
 */

const mockRequest = request as jest.MockedFunction<typeof request>;
const notifications = Notifications as jest.Mocked<typeof Notifications>;
const store = SecureStore as unknown as { __reset: () => void };
const extra = Constants.expoConfig!.extra as Record<string, unknown>;

const REAL_PROJECT = '3f2b9c1e-8a4d-4e6f-9b2a-7c5d1e0f4a3b';
const PLACEHOLDER_PROJECT = '00000000-0000-0000-0000-000000000000';

/** The push token sent in the most recent device registration. */
function lastRegisteredToken(): unknown {
  const calls = mockRequest.mock.calls.filter(([path]) => path === '/devices');
  const options = calls.at(-1)?.[1] as { body?: { pushToken?: unknown } } | undefined;
  return options?.body?.pushToken;
}

beforeEach(() => {
  store.__reset();
  jest.clearAllMocks();
  extra.eas = { projectId: REAL_PROJECT };
  notifications.getPermissionsAsync.mockResolvedValue({
    status: 'granted',
    canAskAgain: true,
  } as never);
  notifications.getExpoPushTokenAsync.mockResolvedValue({
    data: 'ExponentPushToken[test]',
  } as never);
});

describe('enablePush', () => {
  it('registers a token and remembers the choice', async () => {
    expect(await enablePush()).toBe('enabled');
    expect(lastRegisteredToken()).toBe('ExponentPushToken[test]');
    expect(await isPushPreferred()).toBe(true);
  });

  it('reports a build without an EAS project as unavailable instead of throwing', async () => {
    extra.eas = { projectId: PLACEHOLDER_PROJECT };

    // Expo refuses to issue a token for the all-zero placeholder. Before, the throw went
    // unhandled and the switch flipped back with no explanation.
    await expect(enablePush()).resolves.toBe('unavailable');
    expect(notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(await isPushPreferred()).toBe(false);
  });

  it('reports a refusal so the screen can point at system settings', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    } as never);

    expect(await enablePush()).toBe('denied');
    // A refusal that cannot be asked again must not trigger a prompt that will not show.
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('treats a token fetch that fails as unavailable, not as a crash', async () => {
    notifications.getExpoPushTokenAsync.mockRejectedValue(new Error('network'));
    await expect(enablePush()).resolves.toBe('unavailable');
  });
});

describe('refreshRegistration on launch', () => {
  it('keeps reminders off after they were switched off, though the permission stays granted', async () => {
    await enablePush();
    await disablePush();

    // A relaunch. The system permission is still "granted" — switching off in the app
    // does not revoke it — and this is exactly where the old code re-sent the token.
    await refreshRegistration();

    expect(lastRegisteredToken()).toBeNull();
    expect(notifications.getExpoPushTokenAsync).toHaveBeenCalledTimes(1);
  });

  it('re-sends the token for someone who switched reminders on', async () => {
    await enablePush();
    mockRequest.mockClear();

    await refreshRegistration();

    // Tokens rotate; a stale one fails silently, so it is refreshed every launch.
    expect(lastRegisteredToken()).toBe('ExponentPushToken[test]');
  });

  it('clears the token if the permission was revoked in system settings', async () => {
    await enablePush();
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'denied',
      canAskAgain: false,
    } as never);

    await refreshRegistration();

    expect(lastRegisteredToken()).toBeNull();
  });

  it('never prompts', async () => {
    notifications.getPermissionsAsync.mockResolvedValue({
      status: 'undetermined',
      canAskAgain: true,
    } as never);

    await refreshRegistration();

    // A prompt before anyone has asked for reminders is the prompt that gets refused.
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(lastRegisteredToken()).toBeNull();
  });
});
