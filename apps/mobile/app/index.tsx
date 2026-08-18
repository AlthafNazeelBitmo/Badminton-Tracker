import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_SCORING_RULES, describeRules } from '@badminton/contracts';
import { deriveMatch } from '@badminton/analytics';
import { usePalette } from '@/theme/theme';
import { spacing, typography } from '@/theme/tokens';
import { config } from '@/lib/config';

/**
 * Placeholder home screen.
 *
 * It exists to prove the scaffold end to end before any product code is written on top:
 * routing resolves, the theme applies, and — the part actually worth checking — both
 * shared workspace packages import and run inside the React Native bundle. If Metro's
 * monorepo wiring were wrong, this screen would fail to bundle rather than failing
 * later, halfway through a feature.
 */
export default function HomeScreen(): React.JSX.Element {
  const palette = usePalette();
  const insets = useSafeAreaInsets();

  // A three-game comeback: won, having lost the first game.
  const derived = deriveMatch({
    scoring: DEFAULT_SCORING_RULES,
    games: [
      { myScore: 18, opponentScore: 21 },
      { myScore: 21, opponentScore: 19 },
      { myScore: 21, opponentScore: 16 },
    ],
  });

  return (
    <View style={[styles.screen, { backgroundColor: palette.surface0, paddingTop: insets.top }]}>
      <Text style={[typography.title, { color: palette.textPrimary }]}>Badminton Tracker</Text>

      <Text style={[typography.body, styles.line, { color: palette.textSecondary }]}>
        {config.variant} build, talking to {config.apiUrl}
      </Text>

      <Text style={[typography.body, styles.line, { color: palette.textSecondary }]}>
        Format: {describeRules(DEFAULT_SCORING_RULES)}
      </Text>

      <Text style={[typography.body, styles.line, { color: palette.textSecondary }]}>
        Sample match resolves to {derived.result} ({derived.gamesWon}–{derived.gamesLost})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.xl },
  line: { marginTop: spacing.md },
});
