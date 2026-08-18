import { Stack } from 'expo-router';
import { usePalette } from '@/theme/theme';

export default function AuthLayout(): React.JSX.Element {
  const palette = usePalette();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.surface0 },
      }}
    />
  );
}
