import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Localization from 'expo-localization';
import { usePalette } from '@/theme/theme';
import { spacing, typography } from '@/theme/tokens';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-store';
import { describeError } from '@/lib/api/errors';

/** Mirrors the server's minimum, so the rule is stated before the request, not after. */
const MIN_PASSWORD_LENGTH = 12;

export default function RegisterScreen(): React.JSX.Element {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await register({
        name: name.trim(),
        email: email.trim(),
        password,
        // Taken from the device rather than asked for. Every time-based statistic — the
        // day-of-week heatmap, "matches this month" — depends on it, and nobody wants to
        // pick their own time zone from a list of four hundred.
        timeZone: Localization.getCalendars()[0]?.timeZone ?? 'UTC',
      });
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={[styles.screen, { paddingTop: insets.top + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenTitle title="Create your account" subtitle="Your data stays private to you" />

        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
        />

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
        />

        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters`}
          error={tooShort ? `Use at least ${MIN_PASSWORD_LENGTH} characters` : null}
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
          label="Create account"
          onPress={() => void submit()}
          loading={busy}
          disabled={!name.trim() || !email.trim() || password.length < MIN_PASSWORD_LENGTH}
          fullWidth
        />

        <Button label="Back to sign in" variant="ghost" onPress={() => router.back()} fullWidth />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { padding: spacing.xl, gap: spacing.lg },
});
