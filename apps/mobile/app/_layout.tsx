import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '@/theme/theme';

/**
 * Root layout.
 *
 * Providers are ordered outermost-first: gestures need to wrap everything that can be
 * swiped, safe-area insets are read by every screen, and the theme has to be available
 * before the first screen renders so nothing flashes the wrong background.
 */
export default function RootLayout(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ThemedStack />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStack(): React.JSX.Element {
  const { palette, isDark } = useTheme();

  return (
    <>
      {/* `auto` would follow the system appearance, which is wrong when the app's own
          surface is dark and the system is light. The bar follows our surface. */}
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.surface0 },
          // Native gestures and transitions, not a JavaScript imitation of them.
          animation: 'slide_from_right',
        }}
      />
    </>
  );
}
