import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/theme/theme';
import { spacing, typography, UNKNOWN } from '@/theme/tokens';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Loading,
  ScreenTitle,
  Stat,
} from '@/components/ui';
import { MatchRow } from '@/components/match-row';
import { SyncBanner } from '@/components/sync-banner';
import { useAuth } from '@/lib/auth/auth-store';
import { useSync } from '@/lib/sync/use-sync';
import { loadDashboard, type DashboardSummary } from '@/lib/repositories/dashboard';

/**
 * The screen the app opens on.
 *
 * Everything here comes from the local cache, so it renders instantly and works with no
 * signal — including the match recorded thirty seconds ago that the server has not seen
 * yet. The single most important element is the button that records the next one.
 */
export default function DashboardScreen(): React.JSX.Element {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { refresh, syncing } = useSync();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  // `useFocusEffect`, not `useEffect`: returning from recording a match has to show it.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadDashboard().then((next) => {
        if (!cancelled) setSummary(next);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const reload = useCallback(async () => {
    await refresh();
    setSummary(await loadDashboard());
  }, [refresh]);

  if (!summary) return <Loading label="Loading your matches" />;

  return (
    <ScrollView
      contentContainerStyle={[styles.screen, { paddingTop: insets.top + spacing.lg }]}
      refreshControl={
        <RefreshControl
          refreshing={syncing}
          onRefresh={() => void reload()}
          tintColor={palette.accent}
        />
      }
    >
      <ScreenTitle
        title={greeting(user?.name)}
        subtitle={
          summary.totalMatches > 0
            ? `${summary.totalMatches} ${summary.totalMatches === 1 ? 'match' : 'matches'} recorded`
            : 'Record your first match'
        }
      />

      <SyncBanner />

      <Button
        label="Record a match"
        onPress={() => router.push('/match/record')}
        haptic
        fullWidth
        style={styles.record}
      />

      {summary.totalMatches === 0 ? (
        <EmptyState
          title="Nothing recorded yet"
          message="Finish a game, then tap Record a match. It takes about twenty seconds and works without a signal."
        />
      ) : (
        <>
          <Card>
            <View style={styles.stats}>
              <Stat
                label="Win rate"
                value={summary.winRate === null ? null : summary.winRate.toFixed(1)}
                suffix="%"
              />
              <Stat label="Won" value={summary.wins} tone="good" />
              <Stat label="Lost" value={summary.losses} tone="critical" />
            </View>

            <Divider />

            <View style={styles.stats}>
              <Stat
                label="Points won"
                value={summary.pointWinRate === null ? null : summary.pointWinRate.toFixed(1)}
                suffix="%"
              />
              <Stat
                label="Last 10"
                value={summary.recentWinRate === null ? null : summary.recentWinRate.toFixed(0)}
                suffix="%"
              />
              <View style={styles.streak}>
                <Text style={[typography.title, styles.tabular, { color: palette.textPrimary }]}>
                  {summary.currentStreak ? summary.currentStreak.length : UNKNOWN}
                </Text>
                <Text style={[typography.caption, { color: palette.textSecondary }]}>
                  {summary.currentStreak
                    ? summary.currentStreak.kind === 'WIN'
                      ? 'Win streak'
                      : 'Loss streak'
                    : 'Streak'}
                </Text>
              </View>
            </View>
          </Card>

          <View style={styles.sectionHeader}>
            <Text
              accessibilityRole="header"
              style={[typography.heading, { color: palette.textPrimary }]}
            >
              Recent
            </Text>
            {summary.pendingCount > 0 ? (
              <Badge label={`${summary.pendingCount} not synced`} tone="warning" />
            ) : null}
          </View>

          <Card style={styles.list}>
            {summary.recent.map((match, index) => (
              <View key={match.id}>
                {index > 0 ? <Divider /> : null}
                <MatchRow
                  match={match}
                  onPress={() => router.push({ pathname: '/match/[id]', params: { id: match.id } })}
                />
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

/**
 * A greeting by time of day, using the device's own clock.
 *
 * Not a server value: the phone knows what time it is where its owner is standing, which
 * is the only definition that matters for this.
 */
function greeting(name?: string | null): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxxl },
  record: { marginBottom: spacing.xs },
  stats: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  streak: { gap: spacing.xs },
  tabular: { fontVariant: ['tabular-nums'] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  list: { padding: 0, overflow: 'hidden' },
});
