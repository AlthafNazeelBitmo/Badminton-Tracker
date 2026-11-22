import type { Config } from 'tailwindcss';

/**
 * A token colour that still accepts Tailwind's opacity modifiers (`bg-ink/5`,
 * `ring-loss/20`). A bare `var(--x)` cannot be given an alpha, and Tailwind silently
 * drops the modifier — falling back to its default blue ring, for instance.
 */
const token = (name: string) =>
  `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

/**
 * Tailwind is configured against CSS custom properties rather than raw hex values, so
 * light and dark mode are one token swap in `globals.css` and the chart colours and the
 * UI colours can never drift apart.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: token('--surface-1'),
          raised: token('--surface-2'),
          sunken: token('--surface-0'),
          overlay: token('--surface-3'),
        },
        ink: {
          DEFAULT: token('--text-primary'),
          secondary: token('--text-secondary'),
          muted: token('--text-muted'),
        },
        line: {
          DEFAULT: token('--border'),
          strong: token('--border-strong'),
        },
        accent: {
          DEFAULT: token('--accent'),
          hover: token('--accent-hover'),
          soft: token('--accent-soft'),
          ink: token('--accent-ink'),
          text: token('--accent-text'),
        },
        win: { DEFAULT: token('--status-good'), soft: token('--status-good-soft') },
        loss: { DEFAULT: token('--status-critical'), soft: token('--status-critical-soft') },
        warn: { DEFAULT: token('--status-warning'), soft: token('--status-warning-soft') },
        series: {
          1: token('--series-1'),
          2: token('--series-2'),
          3: token('--series-3'),
        },
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
        '2xl': '20px',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Display numerals: tight tracking, because large figures set at default
        // spacing look loose and lose their shape.
        display: ['3.5rem', { lineHeight: '1', letterSpacing: '-0.045em', fontWeight: '600' }],
        hero: ['2.75rem', { lineHeight: '1.02', letterSpacing: '-0.04em', fontWeight: '600' }],
        stat: ['1.875rem', { lineHeight: '1.05', letterSpacing: '-0.035em', fontWeight: '600' }],
      },
      boxShadow: {
        card: '0 1px 2px hsl(var(--shadow-color) / 0.04), 0 1px 1px hsl(var(--shadow-color) / 0.02)',
        lift: '0 1px 2px hsl(var(--shadow-color) / 0.06), 0 6px 16px -4px hsl(var(--shadow-color) / 0.10)',
        pop: '0 2px 4px hsl(var(--shadow-color) / 0.06), 0 16px 40px -8px hsl(var(--shadow-color) / 0.22)',
        glow: '0 0 0 1px rgb(205 242 75 / 0.6), 0 8px 24px -6px rgb(205 242 75 / 0.55)',
        ring: 'var(--ring)',
      },
      spacing: {
        // Height of the mobile bottom navigation, so scroll containers can clear it.
        nav: '4.75rem',
      },
    },
  },
  plugins: [],
};

export default config;
