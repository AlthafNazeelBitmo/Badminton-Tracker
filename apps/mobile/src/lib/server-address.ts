import * as SecureStore from 'expo-secure-store';
import { config } from './config';

/**
 * Which API server the app talks to.
 *
 * A store build talks to the one address compiled into it, and nothing here can change
 * that. A development or preview build lets the person type an address on the sign-in
 * screen instead — needed for an installed APK pointing at an API running on a laptop,
 * whose address on the local network is not knowable when the APK is built.
 *
 * Kept out of production deliberately. A field that redirects sign-in to any server is a
 * phishing aid in an app real accounts use, and a store build has no reason to offer it.
 */

const STORAGE_KEY = 'badminton.serverAddress';

/** True for development and preview builds; false for the build that goes to the stores. */
export const serverAddressEditable = !config.isProduction;

let current = config.apiUrl;

/** The API base URL in use, including the version prefix: `http://host:4000/api/v1`. */
export function apiUrl(): string {
  return current;
}

/**
 * Restores the address chosen on a previous launch.
 *
 * Called before anything talks to the API. Without it, an installed preview build would
 * fall back to its compiled default on every launch and fail to reach a server it was
 * signed in to a minute ago.
 */
export async function loadServerAddress(): Promise<void> {
  if (!serverAddressEditable) return;
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (stored) current = stored;
  } catch {
    // Unreadable storage leaves the compiled default in place, which is still usable.
  }
}

/**
 * Accepts what someone would plausibly type and returns a full API base URL, or null.
 *
 *   192.168.1.23:4000                → http://192.168.1.23:4000/api/v1
 *   http://192.168.1.23:4000/        → http://192.168.1.23:4000/api/v1
 *   https://api.example.com/api/v1   → https://api.example.com/api/v1
 *
 * No port is guessed. "192.168.1.23" means port 80, which is almost certainly wrong for a
 * local API — but silently adding 4000 would be wrong for every address that is not one,
 * and the sign-in error names the address it tried.
 */
export function normaliseServerAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;

  const path = parsed.pathname.replace(/\/+$/, '');
  const base = `${parsed.protocol}//${parsed.host}`;
  return `${base}${path === '' ? '/api/v1' : path}`;
}

/** The address as it should appear in the field: without the `/api/v1` suffix. */
export function displayServerAddress(url: string = current): string {
  return url.replace(/\/api\/v1\/?$/, '');
}

export class InvalidServerAddressError extends Error {
  constructor() {
    super('Enter an address like 192.168.1.23:4000.');
    this.name = 'InvalidServerAddressError';
  }
}

/** Switches to a new address and remembers it for the next launch. */
export async function setServerAddress(input: string): Promise<string> {
  if (!serverAddressEditable) return current;

  const normalised = normaliseServerAddress(input);
  if (!normalised) throw new InvalidServerAddressError();

  current = normalised;
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, normalised);
  } catch {
    // Still used for this session; it just will not survive a restart.
  }
  return normalised;
}

/** Test seam. */
export function __resetServerAddress(): void {
  current = config.apiUrl;
}
