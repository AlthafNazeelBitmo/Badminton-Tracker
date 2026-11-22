import type { Config } from 'tailwindcss';

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
          DEFAULT: 'var(--surface-1)',
          raised: 'var(--surface-2)',
          sunken: 'var(--surface-0)',
          overlay: 'var(--surface-3)',
        },
        ink: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        line: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          ink: 'var(--accent-ink)',
          text: 'var(--accent-text)',
        },
        win: { DEFAULT: 'var(--status-good)', soft: 'var(--status-good-soft)' },
        loss: { DEFAULT: 'var(--status-critical)', soft: 'var(--status-critical-soft)' },
        warn: { DEFAULT: 'var(--status-warning)', soft: 'var(--status-warning-soft)' },
        series: {
          1: 'var(--series-1)',
          2: 'var(--series-2)',
          3: 'var(--series-3)',
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
