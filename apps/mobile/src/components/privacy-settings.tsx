import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { usePalette } from '@/theme/theme';
import { spacing, typography } from '@/theme/tokens';
import { Card, Divider } from './ui';
import {
  capability,
  disableLock,
  enableLock,
  isLockEnabled,
  type BiometricCapability,
} from '@/lib/security/app-lock';
import {
  currentPermission,
  disablePush,
  registerDevice,
  requestPushToken,
  type PushPermission,
} from '@/lib/notifications/push';

/**
 * The two switches worth having: notifications, and the app lock.
 *
 * Both are off until asked for, and both explain what they actually do rather than
 * asserting a benefit. A switch that quietly overstates what it protects is worse than no
 * switch at all.
 */
export function PrivacySettings(): React.JSX.Element {
  const palette = usePalette();

  const [push, setPush] = useState<PushPermission>('undetermined');
  const [lockOn, setLockOn] = useState(false);
  const [biometrics, setBiometrics] = useState<BiometricCapability | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void Promise.all([currentPermission(), isLockEnabled(), capability()]).then(
        ([permission, enabled, support]) => {
          if (cancelled) return;
          setPush(permission);
          setLockOn(enabled);
          setBiometrics(support);
        },
      );

      return () => {
        cancelled = true;
      };
    }, []),
  );

  const togglePush = async (next: boolean) => {
    setBusy(true);
    try {
      if (!next) {
        await disablePush();
        setPush('undetermined');
        return;
      }

      if (push === 'denied') {
        // iOS shows its prompt once. After a refusal the only route back is the system
        // settings app, so saying so is more useful than a switch that silently fails.
        Alert.alert(
          'Notifications are turned off',
          'Turn them on for Badminton Tracker in your device settings, then come back here.',
        );
        return;
      }

      const token = await requestPushToken();
      await registerDevice(token);
      setPush(token ? 'granted' : await currentPermission());
    } finally {
      setBusy(false);
    }
  };

  const toggleLock = async (next: boolean) => {
    setBusy(true);
    try {
      // Both directions require proving it is the owner. Enabling without a successful
      // test locks people out of their own history; disabling without one would let
      // anybody holding the unlocked phone switch the feature off and read everything.
      const changed = next ? await enableLock() : await disableLock();
      if (changed) setLockOn(next);
    } finally {
      setBusy(false);
    }
  };

  const lockUnavailable = !biometrics?.available;

  return (
    <Card>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={[typography.body, { color: palette.textPrimary }]}>Reminders</Text>
          <Text style={[typography.caption, { color: palette.textMuted }]}>
            A nudge when you have not played in a while, and when you reach a goal.
          </Text>
        </View>
        <Switch
          value={push === 'granted'}
          onValueChange={(next) => void togglePush(next)}
          disabled={busy}
          accessibilityLabel="Reminders"
        />
      </View>

      <Divider />

      <View style={styles.row}>
        <View style={styles.text}>
          <Text
            style={[
              typography.body,
              { color: lockUnavailable ? palette.textMuted : palette.textPrimary },
            ]}
          >
            {lockLabel(biometrics)}
          </Text>
          <Text style={[typography.caption, { color: palette.textMuted }]}>
            {biometrics?.needsEnrolment
              ? 'Set this up on your device first.'
              : lockUnavailable
                ? 'This device does not support it.'
                : // Deliberately not overstated. The database is protected by the
                  // platform's own encryption either way; this covers the narrower case
                  // of somebody handed an unlocked phone.
                  'Ask before showing your matches when the app has been closed for a while.'}
          </Text>
        </View>
        <Switch
          value={lockOn}
          onValueChange={(next) => void toggleLock(next)}
          disabled={busy || lockUnavailable}
          accessibilityLabel={lockLabel(biometrics)}
        />
      </View>
    </Card>
  );
}

function lockLabel(biometrics: BiometricCapability | null): string {
  switch (biometrics?.kind) {
    case 'face':
      return 'Require Face ID';
    case 'fingerprint':
      return 'Require fingerprint';
    case 'iris':
      return 'Require iris scan';
    default:
      return 'Require unlock';
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.md,
  },
  text: { flex: 1, gap: 2 },
});
