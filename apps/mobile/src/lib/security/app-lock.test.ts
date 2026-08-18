import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import {
  capability,
  disableLock,
  enableLock,
  isLockEnabled,
  shouldPromptOnLaunch,
} from './app-lock';

/**
 * The lock has one failure mode that matters: locking somebody out of their own match
 * history with no way back in. Every test here is about a route to that.
 */

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const store = SecureStore as unknown as { __reset: () => void };

const FACE = 2;
const FINGERPRINT = 1;

beforeEach(() => {
  store.__reset();
  jest.clearAllMocks();

  auth.hasHardwareAsync.mockResolvedValue(true);
  auth.isEnrolledAsync.mockResolvedValue(true);
  auth.supportedAuthenticationTypesAsync.mockResolvedValue([FACE]);
  auth.authenticateAsync.mockResolvedValue({ success: true });
});

describe('capability', () => {
  it('reports the kind of biometrics the device has', async () => {
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([FINGERPRINT]);
    expect(await capability()).toEqual({
      available: true,
      kind: 'fingerprint',
      needsEnrolment: false,
    });
  });

  it('distinguishes hardware without enrolment from no hardware', async () => {
    auth.isEnrolledAsync.mockResolvedValue(false);

    // Different messages: "set up Face ID first" versus "your phone cannot do this".
    // Conflating them sends somebody looking for a setting that does not exist.
    expect(await capability()).toMatchObject({ available: false, needsEnrolment: true });

    auth.hasHardwareAsync.mockResolvedValue(false);
    expect(await capability()).toMatchObject({ available: false, needsEnrolment: false });
  });
});

describe('enabling the lock', () => {
  it('only switches on after a successful check', async () => {
    expect(await enableLock()).toBe(true);
    expect(await isLockEnabled()).toBe(true);
  });

  it('stays off when the check fails', async () => {
    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' });

    // Enabling without a working test is exactly how somebody is locked out by a sensor
    // that does not recognise them.
    expect(await enableLock()).toBe(false);
    expect(await isLockEnabled()).toBe(false);
  });

  it('offers the device passcode as a fallback', async () => {
    await enableLock();

    // Without it, a wet or cold finger means the app cannot be opened at all — and the
    // passcode is what protects the device anyway, so accepting it concedes nothing.
    expect(auth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });
});

describe('disabling the lock', () => {
  it('requires proving it is the owner', async () => {
    await enableLock();
    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' });

    // Otherwise anybody holding the unlocked phone could switch the lock off and read
    // everything, which would make the feature decorative.
    expect(await disableLock()).toBe(false);
    expect(await isLockEnabled()).toBe(true);
  });

  it('switches off after a successful check', async () => {
    await enableLock();
    expect(await disableLock()).toBe(true);
    expect(await isLockEnabled()).toBe(false);
  });
});

describe('shouldPromptOnLaunch', () => {
  it('is false when the lock was never turned on', async () => {
    expect(await shouldPromptOnLaunch()).toBe(false);
  });

  it('is true when the lock is on and the device can satisfy it', async () => {
    await enableLock();
    expect(await shouldPromptOnLaunch()).toBe(true);
  });

  it('does not lock somebody out after their biometrics are removed', async () => {
    await enableLock();

    // The setting survives, but the phone can no longer satisfy it. Prompting anyway
    // would be an unanswerable question and the owner would never see their data again.
    auth.isEnrolledAsync.mockResolvedValue(false);
    expect(await shouldPromptOnLaunch()).toBe(false);

    auth.hasHardwareAsync.mockResolvedValue(false);
    expect(await shouldPromptOnLaunch()).toBe(false);
  });
});
