import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  DEFAULT_SCORING_RULES,
  playersPerSide,
  type Discipline,
  type SessionType,
} from '@badminton/contracts';
import { usePalette } from '@/theme/theme';
import { MIN_TOUCH_TARGET, radius, spacing, typography } from '@/theme/tokens';
import { Button, Card } from '@/components/ui';
import {
  ScoreEntry,
  ScorePresets,
  visibleGameCount,
  type GameInput,
} from '@/components/score-entry';
import { PersonPicker, type SelectedPerson } from '@/components/person-picker';
import { InvalidMatchError, recordMatch } from '@/lib/repositories/matches';
import { useSync } from '@/lib/sync/use-sync';

/**
 * Quick Match Entry.
 *
 * The specification calls this the killer feature and puts a number on it: twenty to
 * thirty seconds, standing at the edge of a court, having just finished playing. Every
 * decision on this screen answers to that.
 *
 * The form opens ready to use. Singles is preselected because it is the common case, the
 * date is today, and the two games every match has are already showing. A straightforward
 * singles win is two names and four numbers, and nothing else is required.
 *
 * Saving is local and immediate — no spinner, no network. What reaches the server is a
 * queued request that drains whenever there is a signal, which at an indoor court is
 * usually on the walk back to the car.
 */

const DISCIPLINES: Array<{ value: Discipline; label: string }> = [
  { value: 'SINGLES', label: 'Singles' },
  { value: 'DOUBLES', label: 'Doubles' },
  { value: 'MIXED_DOUBLES', label: 'Mixed' },
];

/**
 * The three that come up at a court.
 *
 * The API defines six; offering all of them here would trade a scan of three options for
 * a scan of six on a screen whose whole purpose is speed. The rest are editable on the
 * web app, where there is room to think about it.
 */
const SESSION_TYPES: Array<{ value: SessionType; label: string }> = [
  { value: 'CASUAL', label: 'Casual' },
  { value: 'TRAINING', label: 'Training' },
  { value: 'COMPETITIVE', label: 'Competitive' },
];

const emptyGames: GameInput[] = [
  { myScore: '', opponentScore: '' },
  { myScore: '', opponentScore: '' },
  { myScore: '', opponentScore: '' },
];

export default function RecordMatchScreen(): React.JSX.Element {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refresh } = useSync();

  const [discipline, setDiscipline] = useState<Discipline>('SINGLES');
  const [sessionType, setSessionType] = useState<SessionType>('CASUAL');
  const [partners, setPartners] = useState<SelectedPerson[]>([]);
  const [opponents, setOpponents] = useState<SelectedPerson[]>([]);
  const [games, setGames] = useState<GameInput[]>(emptyGames);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scoring = DEFAULT_SCORING_RULES;
  const perSide = playersPerSide(discipline);

  const played = useMemo(
    () =>
      games
        .slice(0, visibleGameCount(games, scoring))
        .filter((game) => game.myScore !== '' && game.opponentScore !== ''),
    [games, scoring],
  );

  const ready =
    opponents.length === perSide && partners.length === perSide - 1 && played.length > 0;

  const changeDiscipline = (next: Discipline) => {
    setDiscipline(next);
    // Singles has no partner and one opponent. Keeping stale selections around would let
    // somebody save a "singles" match with two opponents attached.
    const nextPerSide = playersPerSide(next);
    setPartners((current) => current.slice(0, nextPerSide - 1));
    setOpponents((current) => current.slice(0, nextPerSide));
  };

  const save = async () => {
    setError(null);
    setSaving(true);

    try {
      await recordMatch({
        discipline,
        session: { date: todayLocalDate(), sessionType },
        partners: partners.map(toRef),
        opponents: opponents.map(toRef),
        games: played.map((game) => ({
          myScore: Number(game.myScore),
          opponentScore: Number(game.opponentScore),
        })),
        scoring,
      });

      // Success is confirmed by a haptic and by the match appearing in the list behind
      // this sheet — not by a dialog that has to be dismissed before the next match can
      // be recorded.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void refresh();
      router.back();
    } catch (failure) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(
        failure instanceof InvalidMatchError
          ? failure.message
          : 'Could not save the match. Please check the scores.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={[styles.screen, { paddingBottom: insets.bottom + spacing.xxxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text
            accessibilityRole="header"
            style={[typography.title, { color: palette.textPrimary }]}
          >
            Record a match
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={() => router.back()}
            style={styles.close}
          >
            <Text style={[typography.body, { color: palette.accent }]}>Cancel</Text>
          </Pressable>
        </View>

        <SegmentedControl
          label="Format"
          options={DISCIPLINES}
          value={discipline}
          onChange={changeDiscipline}
        />

        <Card style={styles.section}>
          <PersonPicker
            label="Opponents"
            max={perSide}
            selected={opponents}
            onChange={setOpponents}
            excludeNames={partners.map((person) => person.name)}
          />

          {perSide > 1 ? (
            <PersonPicker
              label="Partner"
              max={perSide - 1}
              selected={partners}
              onChange={setPartners}
              excludeNames={opponents.map((person) => person.name)}
            />
          ) : null}
        </Card>

        <Card style={styles.section}>
          <Text style={[typography.subheading, { color: palette.textPrimary }]}>Scores</Text>
          <ScoreEntry games={games} onChange={setGames} scoring={scoring} />
          <ScorePresets
            onSelect={(preset) => setGames([...preset, { myScore: '', opponentScore: '' }])}
            scoring={scoring}
          />
        </Card>

        <SegmentedControl
          label="Session"
          options={SESSION_TYPES}
          value={sessionType}
          onChange={setSessionType}
        />

        {error ? (
          <Text
            style={[typography.body, { color: palette.statusCritical }]}
            accessibilityLiveRegion="assertive"
          >
            {error}
          </Text>
        ) : null}

        <Button
          label="Save match"
          onPress={() => void save()}
          loading={saving}
          disabled={!ready}
          haptic
          fullWidth
        />

        <Text style={[typography.caption, styles.reassurance, { color: palette.textMuted }]}>
          Saved on this device straight away. It syncs by itself when you have a connection.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}): React.JSX.Element {
  const palette = usePalette();

  return (
    <View style={styles.segmentGroup}>
      <Text style={[typography.caption, { color: palette.textSecondary }]}>{label}</Text>
      <View
        style={[
          styles.segments,
          { backgroundColor: palette.surface2, borderColor: palette.border },
        ]}
      >
        {options.map((option) => {
          const active = option.value === value;

          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => {
                void Haptics.selectionAsync();
                onChange(option.value);
              }}
              style={[styles.segment, active && { backgroundColor: palette.accent }]}
            >
              <Text
                style={[
                  typography.bodyStrong,
                  { color: active ? palette.accentInk : palette.textSecondary },
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function toRef(person: SelectedPerson): { id?: string; name?: string } {
  return person.id ? { id: person.id } : { name: person.name };
}

/**
 * Today, in the device's own time zone.
 *
 * `toISOString().slice(0, 10)` would give the UTC date, which is the previous day for an
 * evening game anywhere west of Greenwich — quietly filing a Monday-night match under
 * Sunday, and with it every weekday statistic built on top.
 */
function todayLocalDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { padding: spacing.lg, gap: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', paddingLeft: spacing.md },
  section: { gap: spacing.lg },
  segmentGroup: { gap: spacing.sm },
  segments: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reassurance: { textAlign: 'center' },
});
