import * as SecureStore from 'expo-secure-store';

/**
 * Session tokens, in the platform keychain.
 *
 * The web client keeps its tokens in httpOnly cookies, where JavaScript cannot reach
 * them. A native app has no equivalent, so the tokens live in the iOS Keychain or the
 * Android Keystore instead: encrypted at rest, tied to this app's identity, and outside
 * the app's own sandboxed files where a backup or a file-level exploit could pick them up.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is the deliberate part. It keeps the tokens off
 * iCloud Keychain and out of encrypted backups, so restoring a backup onto a new phone
 * does not silently hand that phone a live session. The cost is that a legitimate device
 * transfer requires signing in again, which is the right trade for a credential.
 */

const ACCESS_TOKEN_KEY = 'badminton.accessToken';
const REFRESH_TOKEN_KEY = 'badminton.refreshToken';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.accessToken, OPTIONS),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refreshToken, OPTIONS),
  ]);
}

export async function readTokens(): Promise<StoredTokens | null> {
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_TOKEN_KEY, OPTIONS),
    SecureStore.getItemAsync(REFRESH_TOKEN_KEY, OPTIONS),
  ]);

  // Half a session is no session. Treating a partial read as signed-in would leave the
  // app unable to refresh and unable to explain why.
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY, OPTIONS),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY, OPTIONS),
  ]);
}

/**
 * Whether the keychain is usable at all.
 *
 * On Android this is false on a device with no secure lock screen configured. The app
 * needs to know, because the honest response is to say so rather than to fall back to
 * unencrypted storage without telling anyone.
 */
export async function isSecureStorageAvailable(): Promise<boolean> {
  return SecureStore.isAvailableAsync();
}
