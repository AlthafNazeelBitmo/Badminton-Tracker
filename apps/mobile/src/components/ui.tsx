import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { usePalette } from '@/theme/theme';
import { MIN_TOUCH_TARGET, radius, spacing, typography, UNKNOWN } from '@/theme/tokens';

/**
 * The shared vocabulary of the interface.
 *
 * Two rules run through all of it. Every control is at least `MIN_TOUCH_TARGET` tall,
 * because this app is used standing at the edge of a court, sometimes one-handed and out
 * of breath — a control that is merely difficult to hit on a sofa is unusable there. And
 * every one of them carries an accessibility label and role, because the platform screen
 * readers get these for free only if the components hand them over.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  loading?: boolean;
  /** A short vibration on press. Reserved for actions that commit something. */
  haptic?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  haptic = false,
  disabled,
  onPress,
  style,
  fullWidth = false,
  ...rest
}: ButtonProps): React.JSX.Element {
  const palette = usePalette();
  const inactive = disabled || loading;

  const colours: Record<ButtonVariant, { background: string; text: string; border: string }> = {
    primary: { background: palette.accent, text: palette.accentInk, border: palette.accent },
    secondary: { background: palette.surface2, text: palette.textPrimary, border: palette.border },
    ghost: { background: 'transparent', text: palette.accent, border: 'transparent' },
    danger: { background: palette.surface2, text: palette.statusCritical, border: palette.border },
  };

  const scheme = colours[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // Announced by the screen reader instead of the button silently doing nothing.
      accessibilityState={{ disabled: Boolean(inactive), busy: loading }}
      disabled={inactive}
      onPress={(event) => {
        if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(event);
      }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: scheme.background,
          borderColor: scheme.border,
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={scheme.text} />
      ) : (
        <Text style={[typography.bodyStrong, { color: scheme.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label: string;
  /** Shown beneath the field, in the critical colour. */
  error?: string | null;
  hint?: string;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, hint, style, ...rest },
  ref,
): React.JSX.Element {
  const palette = usePalette();

  return (
    <View style={styles.field}>
      <Text style={[typography.caption, { color: palette.textSecondary }]}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        // Colour alone cannot carry the error — it is invisible to a screen reader and to
        // anyone who cannot distinguish red from grey.
        accessibilityHint={error ?? hint}
        placeholderTextColor={palette.textMuted}
        style={[
          styles.input,
          typography.body,
          {
            backgroundColor: palette.surface2,
            borderColor: error ? palette.statusCritical : palette.border,
            color: palette.textPrimary,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[typography.caption, { color: palette.statusCritical }]}>{error}</Text>
      ) : hint ? (
        <Text style={[typography.caption, { color: palette.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}): React.JSX.Element {
  const palette = usePalette();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface1, borderColor: palette.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * A single figure with its label.
 *
 * `value` is `null` when the number is genuinely unknown — no matches yet, a rate with a
 * zero denominator — and renders as an em dash. Never a zero: "no matches" and "a win
 * rate of 0%" are different facts, and showing them identically states something untrue.
 */
export function Stat({
  label,
  value,
  suffix,
  tone = 'neutral',
}: {
  label: string;
  value: string | number | null;
  suffix?: string;
  tone?: 'neutral' | 'good' | 'critical';
}): React.JSX.Element {
  const palette = usePalette();

  const colour =
    tone === 'good'
      ? palette.statusGood
      : tone === 'critical'
        ? palette.statusCritical
        : palette.textPrimary;

  const known = value !== null && value !== undefined;

  return (
    <View style={styles.stat}>
      <Text
        style={[typography.title, styles.tabular, { color: known ? colour : palette.textMuted }]}
        // Read as one phrase rather than as a number stranded from its label.
        accessibilityLabel={`${label}: ${known ? `${value}${suffix ?? ''}` : 'not available'}`}
      >
        {known ? value : UNKNOWN}
        {known && suffix ? (
          <Text style={[typography.body, { color: palette.textSecondary }]}>{suffix}</Text>
        ) : null}
      </Text>
      <Text style={[typography.caption, { color: palette.textSecondary }]}>{label}</Text>
    </View>
  );
}

export function Badge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'good' | 'critical' | 'warning' | 'accent';
}): React.JSX.Element {
  const palette = usePalette();

  const backgrounds = {
    neutral: palette.surface2,
    good: palette.statusGood,
    critical: palette.statusCritical,
    warning: palette.statusWarning,
    accent: palette.accent,
  } as const;

  const isFilled = tone !== 'neutral';

  return (
    <View style={[styles.badge, { backgroundColor: backgrounds[tone] }]}>
      <Text
        style={[typography.micro, { color: isFilled ? palette.accentInk : palette.textSecondary }]}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * What to show when there is nothing to show.
 *
 * An empty list with no explanation reads as a broken screen. This says which of the two
 * it is — nothing recorded yet, or nothing matching the current filters — and offers the
 * action that resolves it.
 */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onPress: () => void };
}): React.JSX.Element {
  const palette = usePalette();

  return (
    <View style={styles.empty}>
      <Text style={[typography.heading, { color: palette.textPrimary }]}>{title}</Text>
      <Text style={[typography.body, styles.emptyMessage, { color: palette.textSecondary }]}>
        {message}
      </Text>
      {action ? (
        <Button label={action.label} onPress={action.onPress} style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

export function ScreenTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): React.JSX.Element {
  const palette = usePalette();

  return (
    <View style={styles.screenTitle}>
      <Text accessibilityRole="header" style={[typography.title, { color: palette.textPrimary }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[typography.body, { color: palette.textSecondary }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

export function Divider(): React.JSX.Element {
  const palette = usePalette();
  return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
}

export function Loading({ label = 'Loading' }: { label?: string }): React.JSX.Element {
  const palette = usePalette();

  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={palette.accent} />
    </View>
  );
}

/** Figures that appear in columns must line up; text set in them looks mechanical. */
export const tabularNumbers: TextStyle = { fontVariant: ['tabular-nums'] };

const styles = StyleSheet.create({
  button: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  field: { gap: spacing.xs },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  stat: { gap: spacing.xs },
  tabular: { fontVariant: ['tabular-nums'] },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  emptyMessage: { textAlign: 'center', maxWidth: 320 },
  emptyAction: { marginTop: spacing.md },
  screenTitle: { gap: spacing.xs, marginBottom: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth },
  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
});
