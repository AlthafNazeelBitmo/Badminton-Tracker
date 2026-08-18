import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@/theme/theme';
import { AuthProvider, useAuth } from '@/lib/auth/auth-store';
import { SyncProvider } from '@/lib/sync/use-sync';

// Held until the session has been read from the keychain, so the app never shows sign-in
// for a moment before replacing it with the dashboard.
void SplashScreen.preventAutoHideAsync();

/**
 * Root layout.
 *
 * Providers are ordered outermost-first: gestures wrap everything swipeable, safe-area
 * insets are read by every screen, the theme has to exist before the first render, and
 * sync needs to know whether anyone is signed in.
 */
export default function RootLayout(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <SessionGate />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Sends the user to the right half of the app.
 *
 * Routing is decided here rather than by each screen checking for itself, so there is one
 * place that knows the rule and no screen can forget to apply it.
 */
function SessionGate(): React.JSX.Element {
  const { status } = useAuth();
  const { palette, isDark } = useTheme();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    void SplashScreen.hideAsync();

    const inAuthFlow = segments[0] === '(auth)';

    if (status === 'signed-out' && !inAuthFlow) {
      router.replace('/(auth)/sign-in');
    } else if (status === 'signed-in' && inAuthFlow) {
      router.replace('/(tabs)');
    }
  }, [status, segments, router]);

  return (
    <SyncProvider enabled={status === 'signed-in'}>
      {/* `auto` follows the system appearance, which is wrong when the app's surface is
          dark and the system is light. The bar follows our surface instead. */}
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.surface0 },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen
          name="match/record"
          options={{
            // Recording is a task you finish and dismiss, not a place you navigate to.
            presentation: 'modal',
            animation: 'slide_from_bottom',
          }}
        />
      </Stack>
    </SyncProvider>
  );
}
