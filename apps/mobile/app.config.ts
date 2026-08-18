import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App configuration, resolved per release channel.
 *
 * The three variants install side by side on one device, each with its own bundle
 * identifier, name and icon badge. That matters more than it sounds: without it, testing
 * a preview build means uninstalling the copy you actually use to record your matches,
 * and the local database goes with it.
 *
 * Nothing secret belongs here. Everything in this file ships inside the binary and can be
 * read out of it, so `EXPO_PUBLIC_*` values are public by definition — API base URLs and
 * feature flags, never keys.
 */

type Variant = 'development' | 'preview' | 'production';

const VARIANT = (process.env.APP_VARIANT ?? 'development') as Variant;

const VARIANTS: Record<
  Variant,
  { name: string; identifierSuffix: string; scheme: string; defaultApiUrl: string }
> = {
  development: {
    name: 'Badminton (Dev)',
    identifierSuffix: '.dev',
    scheme: 'badminton-dev',
    // Physical devices cannot reach the host's localhost, so a LAN address is set in
    // `.env.local` during development; this default only serves the simulator.
    defaultApiUrl: 'http://localhost:4000/api/v1',
  },
  preview: {
    name: 'Badminton (Preview)',
    identifierSuffix: '.preview',
    scheme: 'badminton-preview',
    defaultApiUrl: 'https://staging-api.badminton.example/api/v1',
  },
  production: {
    name: 'Badminton Tracker',
    identifierSuffix: '',
    scheme: 'badminton',
    defaultApiUrl: 'https://api.badminton.example/api/v1',
  },
};

const variant = VARIANTS[VARIANT];
const BUNDLE_ID = `com.badmintontracker.app${variant.identifierSuffix}`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: variant.name,
  slug: 'badminton-tracker',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: variant.scheme,
  userInterfaceStyle: 'automatic',
  primaryColor: '#2a78d6',
  icon: './assets/icon.png',

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    // The build number is stamped by EAS (`autoIncrement`), not tracked by hand.
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // Shown in the system prompt when the app asks to unlock with Face ID.
      NSFaceIDUsageDescription:
        'Unlock Badminton Tracker with Face ID instead of typing your password.',
      // The app talks to one HTTPS origin and needs no transport-security exemptions.
      NSAllowsArbitraryLoads: false,
    },
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#2a78d6',
    },
    // No location, contacts, camera or storage: the app records scores and nothing else,
    // and every permission it does not ask for is one it cannot leak.
    permissions: ['USE_BIOMETRIC', 'USE_FINGERPRINT', 'VIBRATE', 'RECEIVE_BOOT_COMPLETED'],
    blockedPermissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'RECORD_AUDIO'],
  },

  web: { bundler: 'metro', output: 'static', favicon: './assets/favicon.png' },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    [
      'expo-local-authentication',
      {
        faceIDPermission: 'Unlock Badminton Tracker with Face ID instead of typing your password.',
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        backgroundColor: '#f4f4f1',
        dark: { backgroundColor: '#0d0d0d' },
        imageWidth: 180,
      },
    ],
    [
      'expo-build-properties',
      {
        ios: { deploymentTarget: '16.4' },
        android: { minSdkVersion: 24, compileSdkVersion: 36, targetSdkVersion: 36 },
      },
    ],
  ],

  experiments: { typedRoutes: true },

  updates: {
    // Over-the-air updates carry JavaScript only. A build that changes native code still
    // has to go through the stores, and `runtimeVersion` below is what enforces that: an
    // update is only ever delivered to a binary built from the same native runtime.
    fallbackToCacheTimeout: 0,
    checkAutomatically: 'ON_LOAD',
  },
  runtimeVersion: { policy: 'appVersion' },

  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? variant.defaultApiUrl,
    variant: VARIANT,
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '00000000-0000-0000-0000-000000000000' },
  },
});
