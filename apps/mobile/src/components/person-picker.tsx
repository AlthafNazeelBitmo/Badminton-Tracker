import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { usePalette } from '@/theme/theme';
import { MIN_TOUCH_TARGET, radius, spacing, typography } from '@/theme/tokens';
import { listPlayers, type CachedPlayer } from '@/lib/db/cache';

/**
 * Choosing who you played with, or against.
 *
 * The people you actually play with are a handful, and the same handful most weeks. So
 * the fast path is a row of recent names, one tap each; typing is the fallback for
 * somebody new, not the primary route.
 *
 * The list is capped rather than scrolled. On a phone, twelve names push the score fields
 * below the fold, and having to scroll past the easy part to reach the necessary part is
 * exactly what makes an entry form feel slow.
 */

export interface SelectedPerson {
  /** Present for someone already known; absent for a name being typed now. */
  id?: string;
  name: string;
}

const VISIBLE_SUGGESTIONS = 6;

interface PersonPickerProps {
  label: string;
  /** How many people this side takes. Singles is one; doubles is two. */
  max: number;
  selected: SelectedPerson[];
  onChange: (people: SelectedPerson[]) => void;
  /** Names already chosen on the other side, so nobody can be picked twice. */
  excludeNames?: string[];
}

export function PersonPicker({
  label,
  max,
  selected,
  onChange,
  excludeNames = [],
}: PersonPickerProps): React.JSX.Element {
  const palette = usePalette();
  const [known, setKnown] = useState<CachedPlayer[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Read from the local cache, never the network: this list has to appear instantly and
    // has to work in a sports hall with no signal.
    void listPlayers()
      .then(setKnown)
      .catch(() => setKnown([]));
  }, []);

  const taken = useMemo(
    () =>
      new Set([
        ...selected.map((p) => p.name.toLowerCase()),
        ...excludeNames.map((n) => n.toLowerCase()),
      ]),
    [selected, excludeNames],
  );

  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase();
    return known.filter(
      (player) =>
        !taken.has(player.name.toLowerCase()) &&
        (!term || player.name.toLowerCase().includes(term)),
    );
  }, [known, query, taken]);

  const shown = expanded ? suggestions : suggestions.slice(0, VISIBLE_SUGGESTIONS);
  const full = selected.length >= max;

  const add = (person: SelectedPerson) => {
    if (full) return;
    void Haptics.selectionAsync();
    onChange([...selected, person]);
    setQuery('');
  };

  const remove = (index: number) => {
    onChange(selected.filter((_, position) => position !== index));
  };

  const trimmed = query.trim();
  const canCreate =
    trimmed.length > 0 &&
    !full &&
    !taken.has(trimmed.toLowerCase()) &&
    !suggestions.some((player) => player.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <View style={styles.container}>
      <Text style={[typography.caption, { color: palette.textSecondary }]}>
        {label}
        {max > 1 ? ` (${selected.length}/${max})` : ''}
      </Text>

      {selected.length > 0 ? (
        <View style={styles.chips}>
          {selected.map((person, index) => (
            <Pressable
              key={`${person.name}-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${person.name}`}
              onPress={() => remove(index)}
              style={[styles.chip, { backgroundColor: palette.accent }]}
            >
              <Text style={[typography.bodyStrong, { color: palette.accentInk }]}>
                {person.name} ×
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!full ? (
        <>
          <TextInput
            value={query}
            onChangeText={setQuery}
            accessibilityLabel={`Search or add a ${label.toLowerCase()}`}
            placeholder="Search, or type a new name"
            placeholderTextColor={palette.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (canCreate) add({ name: trimmed });
            }}
            style={[
              styles.search,
              typography.body,
              {
                backgroundColor: palette.surface2,
                borderColor: palette.border,
                color: palette.textPrimary,
              },
            ]}
          />

          <View style={styles.suggestions}>
            {canCreate ? (
              <Suggestion
                label={`Add “${trimmed}”`}
                accent
                onPress={() => add({ name: trimmed })}
              />
            ) : null}

            {shown.map((player) => (
              <Suggestion
                key={player.id}
                label={player.name}
                onPress={() => add({ id: player.id, name: player.name })}
              />
            ))}
          </View>

          {/* Capped rather than scrolled: a long list pushes the score fields off screen,
              and scrolling past the easy part to reach the necessary part feels slow. */}
          {!expanded && suggestions.length > VISIBLE_SUGGESTIONS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show ${suggestions.length - VISIBLE_SUGGESTIONS} more people`}
              onPress={() => setExpanded(true)}
              style={styles.more}
            >
              <Text style={[typography.caption, { color: palette.accent }]}>
                Show {suggestions.length - VISIBLE_SUGGESTIONS} more
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function Suggestion({
  label,
  onPress,
  accent = false,
}: {
  label: string;
  onPress: () => void;
  accent?: boolean;
}): React.JSX.Element {
  const palette = usePalette();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.suggestion,
        {
          backgroundColor: accent ? palette.accentSoft : palette.surface2,
          borderColor: accent ? palette.accent : palette.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[typography.body, { color: accent ? palette.accent : palette.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Horizontal strip of the people played with most recently, for one-tap selection. */
export function RecentPeople({
  people,
  onSelect,
}: {
  people: CachedPlayer[];
  onSelect: (person: SelectedPerson) => void;
}): React.JSX.Element | null {
  const palette = usePalette();
  if (people.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.recent}
    >
      {people.map((person) => (
        <Pressable
          key={person.id}
          accessibilityRole="button"
          accessibilityLabel={`Select ${person.name}`}
          onPress={() => {
            void Haptics.selectionAsync();
            onSelect({ id: person.id, name: person.name });
          }}
          style={[styles.chip, { backgroundColor: palette.surface2, borderColor: palette.border }]}
        >
          <Text style={[typography.body, { color: palette.textPrimary }]}>{person.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  search: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  suggestion: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  more: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  recent: { gap: spacing.sm, paddingVertical: spacing.xs },
});
