import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { usePalette } from '@/theme/theme';
import { typography } from '@/theme/tokens';

/**
 * The four places worth having a permanent home.
 *
 * Recording a match is not one of them: it is a task you finish and dismiss, and it is
 * reached from a button on the dashboard that opens it as a sheet. Giving it a tab would
 * mean leaving a half-typed match behind every time somebody tapped elsewhere.
 */
export default function TabsLayout(): React.JSX.Element {
  const palette = usePalette();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: { backgroundColor: palette.surface1, borderTopColor: palette.border },
        sceneStyle: { backgroundColor: palette.surface0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Today', tabBarIcon: ({ color }) => <TabIcon glyph="◎" color={color} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => <TabIcon glyph="≡" color={color} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: ({ color }) => <TabIcon glyph="◱" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabIcon glyph="⚙" color={color} />,
        }}
      />
    </Tabs>
  );
}

/**
 * Text glyphs rather than an icon font.
 *
 * The alternative is a megabyte of icon font for four symbols. These are marked
 * `accessibilityElementsHidden` because the tab's own title is what a screen reader
 * should announce — reading "circle, Today" is worse than reading "Today".
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }): React.JSX.Element {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[typography.heading, { color }]}
    >
      {glyph}
    </Text>
  );
}
