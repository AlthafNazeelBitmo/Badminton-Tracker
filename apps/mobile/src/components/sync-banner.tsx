import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePalette } from '@/theme/theme';
import { radius, spacing, typography } from '@/theme/tokens';
import { Button } from './ui';
import { useSync } from '@/lib/sync/use-sync';

/**
 * What the sync layer has to say, when it has anything worth saying.
 *
 * Silent when everything is synced, which is nearly always. An app that permanently
 * displays "all good" has spent a strip of a small screen on nothing, and trains people
 * to stop reading the place where the real message will eventually appear.
 *
 * Being offline is not an error and is not styled as one — the app is designed to work
 * that way, and a red banner would suggest something is broken when nothing is. A
 * rejected write *is* worth attention, because only a person can decide what happens
 * to it.
 */
export function SyncBanner(): React.JSX.Element | null {
  const palette = usePalette();
  const router = useRouter();
  const { pending, failed, online } = useSync();

  if (failed > 0) {
    return (
      <View
        style={[
          styles.banner,
          { backgroundColor: palette.surface2, borderColor: palette.statusCritical },
        ]}
      >
        <View style={styles.text}>
          <Text style={[typography.bodyStrong, { color: palette.textPrimary }]}>
            {failed === 1 ? '1 match could not be saved' : `${failed} matches could not be saved`}
          </Text>
          <Text style={[typography.caption, { color: palette.textSecondary }]}>
            The server refused them. Retrying will not change that on its own.
          </Text>
        </View>
        <Button
          label="Review"
          variant="secondary"
          onPress={() => router.push('/(tabs)/settings')}
        />
      </View>
    );
  }

  if (!online && pending > 0) {
    return (
      <View
        style={[styles.banner, { backgroundColor: palette.surface2, borderColor: palette.border }]}
      >
        <View style={styles.text}>
          <Text style={[typography.bodyStrong, { color: palette.textPrimary }]}>
            Offline — {pending} waiting to sync
          </Text>
          <Text style={[typography.caption, { color: palette.textSecondary }]}>
            Saved on this device. They will send themselves when you have a connection.
          </Text>
        </View>
      </View>
    );
  }

  if (!online) {
    return (
      <View
        style={[styles.banner, { backgroundColor: palette.surface2, borderColor: palette.border }]}
      >
        <Text style={[typography.caption, { color: palette.textSecondary }]}>
          Offline. You can still record matches.
        </Text>
      </View>
    );
  }

  if (pending > 0) {
    return (
      <View
        style={[styles.banner, { backgroundColor: palette.surface2, borderColor: palette.border }]}
      >
        <Text style={[typography.caption, { color: palette.textSecondary }]}>
          Syncing {pending} {pending === 1 ? 'match' : 'matches'}…
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  text: { flex: 1, gap: 2 },
});
