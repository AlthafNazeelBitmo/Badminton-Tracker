import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/theme/theme';
import { spacing, typography } from '@/theme/tokens';
import { Button, Field, ScreenTitle } from '@/components/ui';
import { useAuth } from '@/lib/auth/auth-store';
import { describeError } from '@/lib/api/errors';

export default function SignInScreen(): React.JSX.Element {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      // Without this the keyboard covers the password field on iOS. `height` is the
      // behaviour that works on Android, where the window resizes instead.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView
        contentContainerStyle={[styles.screen, { paddingTop: insets.top + spacing.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenTitle title="Badminton Tracker" subtitle="Sign in to your account" />

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
        />

        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          // Lets the platform password manager offer a saved credential, which is both
          // faster and safer than a password short enough to type on a phone.
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
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
          label="Sign in"
          onPress={() => void submit()}
          loading={busy}
          disabled={!email.trim() || !password}
          fullWidth
        />

        <View style={styles.footer}>
          <Text style={[typography.body, { color: palette.textSecondary }]}>
            Don’t have an account?
          </Text>
          <Link href="/(auth)/register" accessibilityRole="link">
            <Text style={[typography.bodyStrong, { color: palette.accent }]}>Create one</Text>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { padding: spacing.xl, gap: spacing.lg },
  footer: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
});
