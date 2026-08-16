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
          soft: 'var(--accent-soft)',
          ink: 'var(--accent-ink)',
        },
        win: 'var(--status-good)',
        loss: 'var(--status-critical)',
        warn: 'var(--status-warning)',
        series: {
          1: 'var(--series-1)',
          2: 'var(--series-2)',
          3: 'var(--series-3)',
        },
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '8px',
        md: '10px',
        lg: '14px',
        xl: '20px',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      fontSize: {
        hero: ['2.75rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        stat: ['1.75rem', { lineHeight: '1.1', letterSpacing: '-0.015em' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,11,11,0.04), 0 1px 3px rgba(11,11,11,0.06)',
        pop: '0 8px 28px rgba(11,11,11,0.14)',
      },
      spacing: {
        // Height of the mobile bottom navigation, so scroll containers can clear it.
        nav: '4.25rem',
      },
    },
  },
  plugins: [],
};

export default config;
