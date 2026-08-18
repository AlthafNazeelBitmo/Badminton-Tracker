import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/theme/theme';
import { radius, spacing, typography, UNKNOWN } from '@/theme/tokens';
import { Card, Divider, EmptyState, Loading, ScreenTitle, Stat } from '@/components/ui';
import { loadAnalytics, type MobileAnalytics } from '@/lib/repositories/analytics';

/**
 * Analytics, computed on the device.
 *
 * The same shared `aggregate` the server uses, over the same raw matches, so the phone and
 * the website cannot disagree — and it works with no signal, which a fetched dashboard
 * would not.
 *
 * The breakdowns show a sample size beside every rate. "100%" from one match and "62%"
 * from forty are not comparable, and a bare percentage invites reading them as if they
 * were.
 */
export default function AnalyticsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<MobileAnalytics | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadAnalytics().then((next) => {
        if (!cancelled) setData(next);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (!data) return <Loading label="Working out your numbers" />;

  if (data.stats.matches === 0) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xxl }]}>
        <EmptyState
          title="Nothing to analyse yet"
          message="Record a few matches and this fills in — opponents, formats, and how your results move over time."
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.screen,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxxl },
      ]}
    >
      <ScreenTitle title="Analytics" subtitle={`Across ${data.stats.matches} matches`} />

      <Card>
        <View style={styles.stats}>
          <Stat
            label="Win rate"
            value={data.stats.winRate === null ? null : data.stats.winRate.toFixed(1)}
            suffix="%"
          />
          <Stat
            label="Games won"
            value={data.stats.gameWinRate === null ? null : data.stats.gameWinRate.toFixed(1)}
            suffix="%"
          />
          <Stat
            label="Points won"
            value={data.stats.pointWinRate === null ? null : data.stats.pointWinRate.toFixed(1)}
            suffix="%"
          />
        </View>

        <Divider />

        <View style={styles.stats}>
          <Stat
            label="Avg margin (won)"
            value={
              data.stats.averageWinningMargin === null
                ? null
                : data.stats.averageWinningMargin.toFixed(1)
            }
          />
          <Stat
            label="Avg margin (lost)"
            value={
              data.stats.averageLosingMargin === null
                ? null
                : data.stats.averageLosingMargin.toFixed(1)
            }
          />
          <Stat label="Point diff" value={data.stats.pointDifferential} />
        </View>
      </Card>

      <Breakdown title="Opponents" empty="No opponents recorded yet." rows={data.opponents} />

      <Breakdown title="By format" empty="No formats recorded yet." rows={data.disciplines} />

      <Breakdown title="By day" empty="Not enough matches yet." rows={data.weekdays} />
    </ScrollView>
  );
}

interface BreakdownRow {
  key: string;
  label: string;
  matches: number;
  winRate: number | null;
}

/**
 * A ranked list with a bar behind each row.
 *
 * The bar is drawn as a plain view rather than through a charting library: it is one
 * rectangle whose width is a percentage, and pulling in a chart engine for that would add
 * a dependency the app would then carry everywhere.
 */
function Breakdown({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: BreakdownRow[];
  empty: string;
}): React.JSX.Element {
  const palette = usePalette();

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[typography.heading, { color: palette.textPrimary }]}>
        {title}
      </Text>

      <Card style={styles.breakdown}>
        {rows.length === 0 ? (
          <Text style={[typography.body, { color: palette.textMuted }]}>{empty}</Text>
        ) : (
          rows.map((row, index) => (
            <View key={row.key}>
              {index > 0 ? <Divider /> : null}
              <View
                style={styles.row}
                accessibilityLabel={
                  row.winRate === null
                    ? `${row.label}: win rate not available, ${row.matches} matches`
                    : `${row.label}: ${row.winRate.toFixed(0)} percent from ${row.matches} matches`
                }
              >
                <View style={styles.rowText}>
                  <Text numberOfLines={1} style={[typography.body, { color: palette.textPrimary }]}>
                    {row.label}
                  </Text>
                  {/* The sample size sits beside every rate. 100% from one match and 62%
                      from forty are not the same claim. */}
                  <Text style={[typography.caption, { color: palette.textMuted }]}>
                    {row.matches} {row.matches === 1 ? 'match' : 'matches'}
                  </Text>
                </View>

                <View style={styles.rate}>
                  <Text
                    style={[typography.bodyStrong, styles.tabular, { color: palette.textPrimary }]}
                  >
                    {row.winRate === null ? UNKNOWN : `${row.winRate.toFixed(0)}%`}
                  </Text>
                  <View style={[styles.track, { backgroundColor: palette.surface2 }]}>
                    <View
                      style={[
                        styles.fill,
                        {
                          width: `${row.winRate ?? 0}%`,
                          backgroundColor:
                            (row.winRate ?? 0) >= 50
                              ? palette.divergePositive
                              : palette.divergeNegative,
                        },
                      ]}
                    />
                  </View>
                </View>
              </View>
            </View>
          ))
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.lg },
  stats: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  section: { gap: spacing.sm },
  breakdown: { padding: spacing.lg, gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  rate: { alignItems: 'flex-end', gap: spacing.xs, width: 96 },
  track: { width: '100%', height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  tabular: { fontVariant: ['tabular-nums'] },
});
