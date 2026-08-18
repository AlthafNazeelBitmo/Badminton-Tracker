import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/theme/theme';
import { spacing, typography, UNKNOWN } from '@/theme/tokens';
import { Badge, Button, Card, Divider, EmptyState, Loading, Stat } from '@/components/ui';
import { formatDate } from '@/components/match-row';
import { getMatch, type CachedMatch } from '@/lib/db/cache';

/**
 * One match in full.
 *
 * Every number here is derived from the games, never stored separately, so it cannot
 * disagree with the scoreline printed above it. The tags — comeback, clutch, blowout —
 * are the shared analytics package's own classifications rather than adjectives invented
 * for this screen.
 */
export default function MatchDetailScreen(): React.JSX.Element {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [match, setMatch] = useState<CachedMatch | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getMatch(String(id)).then((found) => {
        if (!cancelled) setMatch(found);
      });
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  if (match === undefined) return <Loading label="Loading match" />;

  if (match === null) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.xxl }]}>
        <EmptyState
          title="Match not found"
          message="It may have been deleted on another device."
          action={{ label: 'Back', onPress: () => router.back() }}
        />
      </View>
    );
  }

  const won = match.derived.result === 'WIN';
  const opponents = match.opponentNames.filter(Boolean).join(' & ') || 'Unknown opponent';
  const partners = match.partnerNames.filter(Boolean).join(' & ');

  const labels = [
    match.derived.isComeback && 'Comeback',
    match.derived.isCollapse && 'Collapse',
    match.derived.wentToDecider && 'Decider',
    match.derived.isClutch && 'Clutch',
    match.derived.isBlowout && 'Blowout',
  ].filter((label): label is string => Boolean(label));

  return (
    <ScrollView
      contentContainerStyle={[
        styles.screen,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxxl },
      ]}
    >
      <Button label="Back" variant="ghost" onPress={() => router.back()} style={styles.back} />

      <View style={styles.headline}>
        <Text
          accessibilityRole="header"
          style={[typography.display, { color: won ? palette.statusGood : palette.statusCritical }]}
        >
          {won ? 'Won' : 'Lost'}
        </Text>
        <Text style={[typography.body, { color: palette.textSecondary }]}>
          against {opponents}
          {partners ? ` · with ${partners}` : ''}
        </Text>
        <Text style={[typography.caption, { color: palette.textMuted }]}>
          {formatDate(match.playedAt)} ·{' '}
          {match.discipline === 'SINGLES'
            ? 'Singles'
            : match.discipline === 'DOUBLES'
              ? 'Doubles'
              : 'Mixed doubles'}
        </Text>

        {match.pendingLocal ? <Badge label="Not yet synced" tone="warning" /> : null}
      </View>

      <Card>
        {match.games.map((game, index) => {
          const gameWon = game.myScore > game.opponentScore;

          return (
            <View key={game.gameNumber}>
              {index > 0 ? <Divider /> : null}
              <View
                style={styles.gameRow}
                accessibilityLabel={`Game ${game.gameNumber}, ${game.myScore} to ${game.opponentScore}, ${gameWon ? 'won' : 'lost'}`}
              >
                <Text style={[typography.caption, { color: palette.textSecondary }]}>
                  Game {game.gameNumber}
                </Text>
                <Text
                  style={[
                    typography.heading,
                    styles.tabular,
                    { color: gameWon ? palette.statusGood : palette.statusCritical },
                  ]}
                >
                  {game.myScore} – {game.opponentScore}
                </Text>
              </View>
            </View>
          );
        })}
      </Card>

      {labels.length > 0 ? (
        <View style={styles.labels}>
          {labels.map((label) => (
            <Badge key={label} label={label} tone="accent" />
          ))}
        </View>
      ) : null}

      <Card>
        <View style={styles.stats}>
          <Stat label="Points for" value={match.derived.pointsScored} />
          <Stat label="Points against" value={match.derived.pointsConceded} />
          <Stat
            label="Difference"
            value={
              match.derived.pointDifferential > 0
                ? `+${match.derived.pointDifferential}`
                : match.derived.pointDifferential
            }
            tone={match.derived.pointDifferential >= 0 ? 'good' : 'critical'}
          />
        </View>

        <Divider />

        <View style={styles.stats}>
          <Stat label="Games" value={`${match.derived.gamesWon}–${match.derived.gamesLost}`} />
          <Stat label="Closest game" value={match.derived.closestGameMargin} suffix=" pts" />
          <Stat
            label="Duration"
            // Null, not zero: an unrecorded duration is unknown, and a match of zero
            // minutes is a claim nobody made.
            value={match.durationSeconds ? Math.round(match.durationSeconds / 60) : null}
            suffix=" min"
          />
        </View>
      </Card>

      {match.notes ? (
        <Card>
          <Text style={[typography.caption, { color: palette.textSecondary }]}>Notes</Text>
          <Text style={[typography.body, styles.notes, { color: palette.textPrimary }]}>
            {match.notes}
          </Text>
        </Card>
      ) : null}

      {match.venue ? (
        <Text style={[typography.caption, { color: palette.textMuted }]}>
          At {match.venue.name || UNKNOWN}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, gap: spacing.lg },
  back: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  headline: { gap: spacing.xs },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stats: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm },
  tabular: { fontVariant: ['tabular-nums'] },
  notes: { marginTop: spacing.xs },
});
