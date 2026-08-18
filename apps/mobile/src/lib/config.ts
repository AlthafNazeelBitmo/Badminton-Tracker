import Constants from 'expo-constants';

/**
 * Runtime configuration, read once at startup.
 *
 * Everything here comes from `app.config.ts` via `expo-constants`, which means it is
 * baked into the binary and readable by anyone who unzips it. That is fine for what it
 * holds — a base URL and a variant name — and it is the reason nothing else may be added
 * to it. Secrets belong on the server.
 */

export type AppVariant = 'development' | 'preview' | 'production';

interface Extra {
  apiUrl?: string;
  variant?: AppVariant;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

function requireApiUrl(): string {
  const url = extra.apiUrl;

  // Failing loudly at startup beats every request failing later with a confusing
  // network error that looks like the device is offline.
  if (!url) {
    throw new Error(
      'No API URL is configured. Set EXPO_PUBLIC_API_URL, or check the variant defaults in app.config.ts.',
    );
  }

  return url.replace(/\/+$/, '');
}

export const config = {
  apiUrl: requireApiUrl(),
  variant: extra.variant ?? 'development',
  isProduction: extra.variant === 'production',
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;
