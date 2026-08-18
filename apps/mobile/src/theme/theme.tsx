import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, type Palette } from './tokens';

interface ThemeValue {
  palette: Palette;
  scheme: 'light' | 'dark';
  isDark: boolean;
}

const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * Supplies the palette for the device's current appearance.
 *
 * The app follows the system setting rather than offering its own toggle. Someone who
 * has set their phone to dark mode has already answered this question, and a second
 * switch buried in settings only creates a way for the two to disagree.
 */
export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  const value = useMemo<ThemeValue>(
    () => ({
      scheme,
      isDark: scheme === 'dark',
      palette: scheme === 'dark' ? darkPalette : lightPalette,
    }),
    [scheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside a ThemeProvider.');
  return value;
}

/** Shorthand for the common case of needing only the colours. */
export function usePalette(): Palette {
  return useTheme().palette;
}
