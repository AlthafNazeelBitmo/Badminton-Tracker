import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { usePalette } from '@/theme/theme';
import { spacing, typography } from '@/theme/tokens';
import { Button } from './ui';
import { authenticate, shouldPromptOnLaunch } from '@/lib/security/app-lock';

/**
 * Covers the app until the owner has proved it is them.
 *
 * An overlay rather than a wrapper, so the screens underneath stay mounted. Unmounting
 * them would throw away the navigation stack and any half-typed match every time the
 * phone was put down.
 *
 * Two moments matter, and only two. Launch, and returning to the foreground after long
 * enough that the phone plausibly changed hands. A prompt on every glance at another app
 * and back would be intolerable, and an app people fight with is an app whose lock they
 * turn off — so the grace period is what keeps the feature switched on.
 */

/** Long enough to answer a message; short enough that a handed-over phone is caught. */
const GRACE_PERIOD_MS = 60_000;

export function AppLockOverlay(): React.JSX.Element | null {
  const palette = usePalette();

  const [required, setRequired] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [failed, setFailed] = useState(false);

  const backgroundedAt = useRef<number | null>(null);

  const prompt = useCallback(async () => {
    setFailed(false);
    const passed = await authenticate();
    setUnlocked(passed);
    setFailed(!passed);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void shouldPromptOnLaunch().then((needed) => {
      if (cancelled) return;
      setRequired(needed);
      if (needed) void prompt();
      else setUnlocked(true);
    });

    return () => {
      cancelled = true;
    };
  }, [prompt]);

  useEffect(() => {
    if (!required) return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt.current ??= Date.now();
        return;
      }

      if (state === 'active') {
        const away = backgroundedAt.current;
        backgroundedAt.current = null;
        if (away !== null && Date.now() - away > GRACE_PERIOD_MS) {
          setUnlocked(false);
          void prompt();
        }
      }
    });

    return () => subscription.remove();
  }, [required, prompt]);

  // Covered until the answer is known, so a locked app never shows a frame of its
  // contents before the prompt appears.
  if (required === null) {
    return <View style={[styles.cover, { backgroundColor: palette.surface0 }]} />;
  }

  if (!unlocked) {
    return (
      <View style={[styles.cover, styles.centred, { backgroundColor: palette.surface0 }]}>
        <Text accessibilityRole="header" style={[typography.title, { color: palette.textPrimary }]}>
          Badminton Tracker
        </Text>
        <Text style={[typography.body, styles.message, { color: palette.textSecondary }]}>
          {failed
            ? 'Not recognised. Try again to see your matches.'
            : 'Unlock to see your matches.'}
        </Text>
        <Button label="Unlock" onPress={() => void prompt()} haptic />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  centred: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  message: { textAlign: 'center' },
});
