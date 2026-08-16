'use client';

import { ThemeProvider as NextThemeProvider, useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from './ui';

/**
 * Light, dark and system. `system` is the default because the right answer is usually
 * whatever the rest of the device is doing, and someone recording a match in a dim
 * sports hall should not be handed a white screen.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemeProvider>
  );
}

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the OS preference, so the control renders inert until
  // mounted rather than flashing the wrong icon.
  useEffect(() => setMounted(true), []);

  const cycle = () => {
    setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system');
  };

  const label = !mounted
    ? 'Theme'
    : theme === 'system'
      ? `System theme (currently ${resolvedTheme})`
      : theme === 'light'
        ? 'Light theme'
        : 'Dark theme';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={cycle}
      aria-label={`${label}. Activate to change.`}
      title={label}
    >
      <span aria-hidden="true">
        {!mounted ? '◐' : theme === 'system' ? '◐' : theme === 'light' ? '☀' : '☾'}
      </span>
    </Button>
  );
}
