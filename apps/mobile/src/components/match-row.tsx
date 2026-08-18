import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usePalette } from '@/theme/theme';
import { MIN_TOUCH_TARGET, spacing, typography } from '@/theme/tokens';
import type { CachedMatch } from '@/lib/db/cache';

/**
 * One match in a list.
 *
 * The result reads from the left edge, in colour and in text. Colour alone would be
 * unreadable to a screen reader and to anyone who cannot distinguish the two hues, so the
 * W/L letter carries the same information — and the whole row is labelled as a sentence
 * so a screen reader announces the match rather than four disconnected fragments.
 */
export function MatchRow({
  match,
  onPress,
}: {
  match: CachedMatch;
  onPress?: () => void;
}): React.JSX.Element {
  const palette = usePalette();

  const won = match.derived.result === 'WIN';
  const resultColour = won ? palette.statusGood : palette.statusCritical;

  const opponents = match.opponentNames.filter(Boolean).join(' & ') || 'Unknown opponent';
  const partners = match.partnerNames.filter(Boolean).join(' & ');
  const scoreline = match.games.map((game) => `${game.myScore}-${game.opponentScore}`).join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        `${won ? 'Won' : 'Lost'} against ${opponents}` +
        `${partners ? ` with ${partners}` : ''}, ${scoreline}, ${formatDate(match.playedAt)}` +
        `${match.pendingLocal ? ', not yet synced' : ''}`
      }
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: palette.surface2 }]}
    >
      <View style={[styles.result, { backgroundColor: resultColour }]}>
        <Text style={[typography.bodyStrong, { color: palette.accentInk }]}>{won ? 'W' : 'L'}</Text>
      </View>

      <View style={styles.body}>
        <Text numberOfLines={1} style={[typography.bodyStrong, { color: palette.textPrimary }]}>
          {opponents}
        </Text>
        <Text style={[typography.caption, styles.tabular, { color: palette.textSecondary }]}>
          {scoreline}
          {partners ? ` · with ${partners}` : ''}
        </Text>
      </View>

      <View style={styles.meta}>
        <Text style={[typography.caption, { color: palette.textMuted }]}>
          {formatDate(match.playedAt)}
        </Text>
        {match.pendingLocal ? (
          // A quiet dot rather than a badge: it means "on its way", which is the normal
          // state right after recording and not something to alarm anyone about.
          <Text style={[typography.micro, { color: palette.statusWarning }]}>● queued</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * A short date, relative for the last few days.
 *
 * "Today" and "Yesterday" are what somebody scanning their recent matches is actually
 * looking for; an exact date only becomes useful once it is far enough back to be a
 * memory rather than a recent event.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const days = Math.floor(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / (24 * 60 * 60 * 1000),
  );

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: 'short' });

  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    // The year only when it is not this one, so the common case stays short.
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET + 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  result: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  meta: { alignItems: 'flex-end', gap: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
});
