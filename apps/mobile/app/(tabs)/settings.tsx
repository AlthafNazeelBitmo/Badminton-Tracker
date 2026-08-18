import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/theme/theme';
import { spacing, typography } from '@/theme/tokens';
import { Badge, Button, Card, Divider, ScreenTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-store';
import { useSync } from '@/lib/sync/use-sync';
import { listAll, remove as removeEntry, retryFailed, type OutboxEntry } from '@/lib/sync/outbox';
import { PrivacySettings } from '@/components/privacy-settings';
import { config } from '@/lib/config';

/**
 * Account, sync state, and the queue.
 *
 * The failed-writes section is the part that earns its place. A rejected match is the one
 * situation the app cannot resolve on its own — the server has given a final answer — so
 * it is surfaced with both options a person might want, and never quietly discarded.
 */
export default function SettingsScreen(): React.JSX.Element {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { pending, failed, online, refresh, syncing } = useSync();

  const [entries, setEntries] = useState<OutboxEntry[]>([]);

  const load = useCallback(async () => {
    setEntries(await listAll());
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void listAll().then((next) => {
        if (!cancelled) setEntries(next);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const rejected = entries.filter((entry) => entry.status === 'FAILED');

  const confirmSignOut = () => {
    const warning =
      pending > 0
        ? `${pending} ${pending === 1 ? 'match has' : 'matches have'} not synced yet. Signing out deletes them from this device.`
        : 'Your matches stay on the server. This device’s copy is removed.';

    Alert.alert('Sign out?', warning, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  const discard = (entry: OutboxEntry) => {
    Alert.alert(
      'Discard this match?',
      'It has not been saved to the server, and this cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void removeEntry(entry.id).then(load);
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.screen,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxxl },
      ]}
    >
      <ScreenTitle title="Settings" />

      <Card>
        <Text style={[typography.caption, { color: palette.textSecondary }]}>Signed in as</Text>
        <Text style={[typography.subheading, { color: palette.textPrimary }]}>
          {user?.name ?? 'Unknown'}
        </Text>
        <Text style={[typography.caption, { color: palette.textMuted }]}>{user?.email}</Text>
      </Card>

      <Card>
        <View style={styles.row}>
          <Text style={[typography.body, { color: palette.textPrimary }]}>Connection</Text>
          <Badge label={online ? 'Online' : 'Offline'} tone={online ? 'good' : 'neutral'} />
        </View>

        <Divider />

        <View style={styles.row}>
          <Text style={[typography.body, { color: palette.textPrimary }]}>Waiting to sync</Text>
          <Text style={[typography.bodyStrong, { color: palette.textPrimary }]}>{pending}</Text>
        </View>

        <Divider />

        <View style={styles.row}>
          <Text style={[typography.body, { color: palette.textPrimary }]}>Refused by server</Text>
          <Text
            style={[
              typography.bodyStrong,
              { color: failed > 0 ? palette.statusCritical : palette.textPrimary },
            ]}
          >
            {failed}
          </Text>
        </View>

        <Button
          label="Sync now"
          variant="secondary"
          loading={syncing}
          onPress={() => {
            void refresh().then(load);
          }}
          style={styles.action}
        />
      </Card>

      {rejected.length > 0 ? (
        <View style={styles.section}>
          <Text
            accessibilityRole="header"
            style={[typography.heading, { color: palette.textPrimary }]}
          >
            Needs your attention
          </Text>
          <Text style={[typography.caption, { color: palette.textSecondary }]}>
            The server refused these. Retrying sends the original request again — safe to do,
            because a duplicate cannot be created.
          </Text>

          {rejected.map((entry) => (
            <Card key={entry.id} style={styles.failedCard}>
              <Text style={[typography.bodyStrong, { color: palette.textPrimary }]}>
                {describeKind(entry)}
              </Text>
              <Text style={[typography.caption, { color: palette.statusCritical }]}>
                {entry.lastError ?? 'The server refused this request.'}
              </Text>
              <Text style={[typography.micro, { color: palette.textMuted }]}>
                Queued {new Date(entry.createdAt).toLocaleString()} · {entry.attempts} attempts
              </Text>

              <View style={styles.failedActions}>
                <Button
                  label="Retry"
                  variant="secondary"
                  onPress={() => {
                    void retryFailed(entry.id).then(refresh).then(load);
                  }}
                />
                <Button label="Discard" variant="danger" onPress={() => discard(entry)} />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <PrivacySettings />

      <Card>
        <Text style={[typography.caption, { color: palette.textSecondary }]}>About</Text>
        <Text style={[typography.body, { color: palette.textPrimary }]}>
          Version {config.appVersion}
          {config.isProduction ? '' : ` (${config.variant})`}
        </Text>
        <Text style={[typography.caption, { color: palette.textMuted }]}>
          Your matches are private to your account. Nothing is shared with anyone.
        </Text>
      </Card>

      <Button label="Sign out" variant="danger" onPress={confirmSignOut} fullWidth />
    </ScrollView>
  );
}

function describeKind(entry: OutboxEntry): string {
  switch (entry.kind) {
    case 'CREATE_MATCH':
      return 'A match you recorded';
    case 'UPDATE_MATCH':
      return 'A change to a match';
    case 'DELETE_MATCH':
      return 'A match you deleted';
    case 'CREATE_PLAYER':
      return 'A player you added';
    default:
      return 'A change you made';
  }
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  action: { marginTop: spacing.md },
  section: { gap: spacing.sm },
  failedCard: { gap: spacing.xs },
  failedActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
