import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/theme/theme';
import { MIN_TOUCH_TARGET, radius, spacing, typography } from '@/theme/tokens';
import { Divider, EmptyState, Loading, ScreenTitle } from '@/components/ui';
import { MatchRow } from '@/components/match-row';
import { useSync } from '@/lib/sync/use-sync';
import { listMatches, type CachedMatch } from '@/lib/db/cache';

type Filter = 'ALL' | 'WIN' | 'LOSS' | 'SINGLES' | 'DOUBLES';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'WIN', label: 'Won' },
  { value: 'LOSS', label: 'Lost' },
  { value: 'SINGLES', label: 'Singles' },
  { value: 'DOUBLES', label: 'Doubles' },
];

/**
 * Every match, newest first.
 *
 * Read from the local cache and rendered with `FlashList`, which recycles rows rather
 * than holding one view per match. A `ScrollView` here would build the entire history
 * before showing anything, and after a couple of years of play that is a visible stall on
 * a mid-range phone.
 */
export default function HistoryScreen(): React.JSX.Element {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh, syncing } = useSync();

  const [matches, setMatches] = useState<CachedMatch[] | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');

  const load = useCallback(async () => {
    setMatches(await listMatches({ limit: 1000 }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void listMatches({ limit: 1000 }).then((next) => {
        if (!cancelled) setMatches(next);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const visible = useMemo(() => {
    if (!matches) return [];

    switch (filter) {
      case 'WIN':
        return matches.filter((match) => match.derived.result === 'WIN');
      case 'LOSS':
        return matches.filter((match) => match.derived.result === 'LOSS');
      case 'SINGLES':
        return matches.filter((match) => match.discipline === 'SINGLES');
      case 'DOUBLES':
        return matches.filter((match) => match.discipline !== 'SINGLES');
      default:
        return matches;
    }
  }, [matches, filter]);

  if (!matches) return <Loading label="Loading your history" />;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.lg }]}>
      <View style={styles.header}>
        <ScreenTitle
          title="History"
          subtitle={`${visible.length} ${visible.length === 1 ? 'match' : 'matches'}`}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {FILTERS.map((option) => {
            const active = option.value === filter;

            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Show ${option.label.toLowerCase()}`}
                onPress={() => setFilter(option.value)}
                style={[
                  styles.filter,
                  {
                    backgroundColor: active ? palette.accent : palette.surface2,
                    borderColor: active ? palette.accent : palette.border,
                  },
                ]}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: active ? palette.accentInk : palette.textSecondary },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {visible.length === 0 ? (
        <EmptyState
          title={matches.length === 0 ? 'No matches yet' : 'Nothing matches this filter'}
          message={
            matches.length === 0
              ? 'Matches you record appear here, whether or not you had a signal at the time.'
              : 'Try a different filter to see more of your history.'
          }
          {...(matches.length > 0
            ? { action: { label: 'Show all', onPress: () => setFilter('ALL') } }
            : {})}
        />
      ) : (
        <FlashList
          data={visible}
          keyExtractor={(match) => match.id}
          ItemSeparatorComponent={Divider}
          refreshControl={
            <RefreshControl
              refreshing={syncing}
              onRefresh={() => {
                void refresh().then(load);
              }}
              tintColor={palette.accent}
            />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
          renderItem={({ item }) => (
            <MatchRow
              match={item}
              onPress={() => router.push({ pathname: '/match/[id]', params: { id: item.id } })}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: spacing.lg },
  filters: { gap: spacing.sm, paddingBottom: spacing.md },
  filter: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
