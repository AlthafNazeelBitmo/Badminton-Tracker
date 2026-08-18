import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

/**
 * Optional biometric lock.
 *
 * Worth being honest about what this is and is not. The device is already locked by the
 * operating system; this guards against the narrower case of somebody handed an unlocked
 * phone. It is a privacy screen over a personal record, not a second layer of encryption
 * — the local database is protected by the platform's own file encryption either way, and
 * pretending otherwise would be a security claim this does not earn.
 *
 * Which is exactly why it is off by default and why declining it costs nothing. An app
 * that made somebody authenticate to look at their badminton scores would simply be
 * uninstalled.
 */

const LOCK_ENABLED_KEY = 'badminton.appLock';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'none';

export interface BiometricCapability {
  available: boolean;
  kind: BiometricKind;
  /**
   * True when the hardware exists but nothing is enrolled. Worth distinguishing: the
   * honest message is "set up Face ID first", not "your phone cannot do this".
   */
  needsEnrolment: boolean;
}

export async function capability(): Promise<BiometricCapability> {
  const [hasHardware, enrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  if (!hasHardware) return { available: false, kind: 'none', needsEnrolment: false };

  const kind: BiometricKind = types.includes(
    LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
  )
    ? 'face'
    : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
      ? 'fingerprint'
      : types.includes(LocalAuthentication.AuthenticationType.IRIS)
        ? 'iris'
        : 'none';

  return { available: enrolled, kind, needsEnrolment: !enrolled };
}

export async function isLockEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(LOCK_ENABLED_KEY)) === 'true';
}

/**
 * Turns the lock on, but only after proving it works.
 *
 * Enabling without a successful test is how somebody ends up locked out of their own
 * history by a sensor that does not recognise them.
 */
export async function enableLock(): Promise<boolean> {
  const passed = await authenticate('Confirm it’s you to turn on the app lock');
  if (!passed) return false;

  await SecureStore.setItemAsync(LOCK_ENABLED_KEY, 'true');
  return true;
}

/**
 * Turns the lock off, after proving it is the owner asking.
 *
 * Without this check, anybody holding the unlocked phone could disable the lock and then
 * read everything — which would make the feature decorative.
 */
export async function disableLock(): Promise<boolean> {
  const passed = await authenticate('Confirm it’s you to turn off the app lock');
  if (!passed) return false;

  await SecureStore.deleteItemAsync(LOCK_ENABLED_KEY);
  return true;
}

export async function authenticate(reason = 'Unlock Badminton Tracker'): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    // The device passcode is offered as the fallback. Without it, a wet or cold finger
    // means the app cannot be opened at all — and the passcode is what protects the
    // device in the first place, so accepting it concedes nothing.
    disableDeviceFallback: false,
    cancelLabel: 'Cancel',
  });

  return result.success;
}

/**
 * Whether the app should ask for a biometric check right now.
 *
 * Both conditions have to hold. A lock left switched on after Face ID was removed from
 * the phone would otherwise be unsatisfiable, and the owner would be locked out of their
 * own data with no way back in.
 */
export async function shouldPromptOnLaunch(): Promise<boolean> {
  if (!(await isLockEnabled())) return false;
  return (await capability()).available;
}
