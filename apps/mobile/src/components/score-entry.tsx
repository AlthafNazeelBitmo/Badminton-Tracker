import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { gamesRequiredToWin, validateGameScore, type ScoringRules } from '@badminton/contracts';
import { usePalette } from '@/theme/theme';
import { MIN_TOUCH_TARGET, radius, spacing, typography } from '@/theme/tokens';

/**
 * Entering the scores.
 *
 * The specification's target is a match recorded in twenty to thirty seconds, and this is
 * where that is won or lost. Three decisions follow from it:
 *
 *  - **The numeric keypad, always.** `keyboardType="number-pad"` on both fields, so no
 *    tap is ever spent switching layouts.
 *  - **A third game appears only when it is needed.** Showing an empty decider on every
 *    two-game match is a field to skip past every single time.
 *  - **Feedback per game, not on save.** A game that cannot have happened is marked as
 *    soon as both numbers are present, while the user is still standing on the court and
 *    can remember what the score actually was.
 */

export interface GameInput {
  myScore: string;
  opponentScore: string;
}

interface ScoreEntryProps {
  games: GameInput[];
  onChange: (games: GameInput[]) => void;
  scoring: ScoringRules;
}

export function ScoreEntry({ games, onChange, scoring }: ScoreEntryProps): React.JSX.Element {
  const palette = usePalette();

  const visible = useMemo(() => visibleGameCount(games, scoring), [games, scoring]);

  const update = (index: number, side: keyof GameInput, raw: string) => {
    // Digits only. A paste or a hardware keyboard can put anything in here, and a stray
    // character would fail validation with a message about the score rather than the typo.
    const value = raw.replace(/[^0-9]/g, '').slice(0, 3);
    const next = games.map((game, position) =>
      position === index ? { ...game, [side]: value } : game,
    );
    onChange(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={[typography.caption, styles.gameLabel, { color: palette.textMuted }]} />
        <Text style={[typography.caption, styles.column, { color: palette.textSecondary }]}>
          You
        </Text>
        <Text style={[typography.caption, styles.column, { color: palette.textSecondary }]}>
          Them
        </Text>
      </View>

      {games.slice(0, visible).map((game, index) => {
        const issue = gameIssue(game, scoring);

        return (
          <View key={index} style={styles.row}>
            <Text style={[typography.caption, styles.gameLabel, { color: palette.textSecondary }]}>
              G{index + 1}
            </Text>

            <ScoreField
              value={game.myScore}
              onChangeText={(value) => update(index, 'myScore', value)}
              label={`Game ${index + 1}, your score`}
              invalid={Boolean(issue)}
            />

            <ScoreField
              value={game.opponentScore}
              onChangeText={(value) => update(index, 'opponentScore', value)}
              label={`Game ${index + 1}, their score`}
              invalid={Boolean(issue)}
            />

            {issue ? (
              <Text
                style={[typography.micro, styles.issue, { color: palette.statusCritical }]}
                accessibilityLiveRegion="polite"
              >
                {issue}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function ScoreField({
  value,
  onChangeText,
  label,
  invalid,
}: {
  value: string;
  onChangeText: (value: string) => void;
  label: string;
  invalid: boolean;
}): React.JSX.Element {
  const palette = usePalette();

  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      accessibilityLabel={label}
      // The only keyboard this field ever needs. Switching layouts costs a tap per game.
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={3}
      selectTextOnFocus
      placeholder="–"
      placeholderTextColor={palette.textMuted}
      style={[
        styles.scoreField,
        typography.title,
        {
          backgroundColor: palette.surface2,
          borderColor: invalid ? palette.statusCritical : palette.border,
          color: palette.textPrimary,
        },
      ]}
    />
  );
}

/**
 * Quick buttons for the scores that come up constantly.
 *
 * A straight-games win at 21 is the single most common thing anyone records. Two taps
 * beats six keystrokes, and the keypad is still there for everything else.
 */
export function ScorePresets({
  onSelect,
  scoring,
}: {
  onSelect: (games: GameInput[]) => void;
  scoring: ScoringRules;
}): React.JSX.Element {
  const palette = usePalette();
  const target = scoring.pointsToWin;

  const presets: Array<{ label: string; games: GameInput[] }> = [
    {
      label: `${target}-15, ${target}-17`,
      games: [
        { myScore: String(target), opponentScore: '15' },
        { myScore: String(target), opponentScore: '17' },
      ],
    },
    {
      label: `15-${target}, 17-${target}`,
      games: [
        { myScore: '15', opponentScore: String(target) },
        { myScore: '17', opponentScore: String(target) },
      ],
    },
  ];

  return (
    <View style={styles.presets}>
      {presets.map((preset) => (
        <Pressable
          key={preset.label}
          accessibilityRole="button"
          accessibilityLabel={`Fill in ${preset.label}`}
          onPress={() => {
            void Haptics.selectionAsync();
            onSelect(preset.games);
          }}
          style={({ pressed }) => [
            styles.preset,
            {
              backgroundColor: palette.surface2,
              borderColor: palette.border,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Text style={[typography.caption, { color: palette.textSecondary }]}>{preset.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * How many game rows to show.
 *
 * One more than the number completed, capped at the format's maximum, and never fewer
 * than the minimum needed to win. A decider appears the moment the first two games are
 * split, and not before.
 */
export function visibleGameCount(games: GameInput[], scoring: ScoringRules): number {
  const needed = gamesRequiredToWin(scoring);

  let mine = 0;
  let theirs = 0;
  let completed = 0;

  for (const game of games) {
    if (!isComplete(game)) break;
    completed += 1;

    const my = Number(game.myScore);
    const their = Number(game.opponentScore);
    if (my > their) mine += 1;
    else if (their > my) theirs += 1;

    // Once somebody has won, no further row is offered — a match cannot continue past it.
    if (mine === needed || theirs === needed) return completed;
  }

  return Math.min(scoring.bestOf, Math.max(needed, completed + 1));
}

function isComplete(game: GameInput): boolean {
  return game.myScore.length > 0 && game.opponentScore.length > 0;
}

/**
 * The problem with one game, if both numbers are in and there is one.
 *
 * Deliberately silent until both fields are filled: flagging `21-` while somebody is
 * still typing the second number is noise, and it trains people to ignore the warning.
 */
function gameIssue(game: GameInput, scoring: ScoringRules): string | null {
  if (!isComplete(game)) return null;

  const result = validateGameScore(
    { myScore: Number(game.myScore), opponentScore: Number(game.opponentScore) },
    scoring,
  );

  return result.valid ? null : (result.issues[0]?.message ?? 'That score is not possible.');
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  gameLabel: { width: 28 },
  column: { flex: 1, textAlign: 'center' },
  scoreField: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET + 8,
    borderWidth: 1,
    borderRadius: radius.md,
    textAlign: 'center',
  },
  issue: { width: '100%', paddingLeft: 28 + spacing.sm },
  presets: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  preset: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
});
