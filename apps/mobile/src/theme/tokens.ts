/**
 * Design tokens, mirroring `apps/web/src/app/globals.css`.
 *
 * The same values, deliberately duplicated rather than generated. A build step that
 * turned CSS custom properties into TypeScript would be a real dependency between two
 * apps that otherwise share nothing but the API, and the palette changes about once a
 * year. The cost of a copy is one careless edit; the cost of the pipeline is permanent.
 *
 * Both themes are *selected*, not derived: the dark values are steps chosen for a dark
 * surface and checked against it, not an automatic inversion of the light ones.
 */

export interface Palette {
  /** App background, behind everything. */
  surface0: string;
  /** Cards and sheets. */
  surface1: string;
  /** Raised elements on a card: inputs, chips. */
  surface2: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;

  border: string;
  borderStrong: string;

  /** Volt: a fill only — primary buttons, selected segments, the active tab. */
  accent: string;
  accentSoft: string;
  /** Text and icons drawn on an `accent` fill. Dark in both themes. */
  accentInk: string;
  /** The accent as text, a tint or a link: volt is too light to read on white. */
  accentText: string;

  /** Reserved for state. Never reused as a chart series colour. */
  statusGood: string;
  statusWarning: string;
  statusCritical: string;
  /** Soft tints behind status text, for badges and result chips. */
  statusGoodSoft: string;
  statusWarningSoft: string;
  statusCriticalSoft: string;

  /** Categorical series in fixed order. A chart never cycles hues to fit more series. */
  series: readonly [string, string, string];

  divergePositive: string;
  divergeNegative: string;
  divergeNeutral: string;

  /** Sequential ramp for the activity heatmap, lightest first. */
  sequential: readonly [string, string, string, string, string, string];

  grid: string;
  axis: string;
}

export const lightPalette: Palette = {
  surface0: '#f4f5f7',
  surface1: '#ffffff',
  surface2: '#ffffff',

  textPrimary: '#0a0b0d',
  textSecondary: '#4b5058',
  textMuted: '#747a83',

  border: '#e5e7eb',
  borderStrong: '#d1d5db',

  accent: '#cdf24b',
  accentSoft: '#f2fbd2',
  accentInk: '#0b0d06',
  accentText: '#4a7300',

  statusGood: '#047857',
  statusWarning: '#a15c07',
  statusCritical: '#be123c',
  statusGoodSoft: '#e7f6ef',
  statusWarningSoft: '#fdf3e2',
  statusCriticalSoft: '#fdebef',

  series: ['#4a7300', '#2563eb', '#d97706'],

  divergePositive: '#5e8f00',
  divergeNegative: '#e11d48',
  divergeNeutral: '#e5e7eb',

  sequential: ['#eceef1', '#e4f7a6', '#c6ea56', '#8fc414', '#5e8f00', '#3d5e00'],

  grid: '#eceef1',
  axis: '#d1d5db',
};

export const darkPalette: Palette = {
  surface0: '#08090a',
  surface1: '#131416',
  surface2: '#1b1c1f',

  textPrimary: '#f4f5f6',
  textSecondary: '#a8adb5',
  textMuted: '#757b84',

  border: '#222428',
  borderStrong: '#31343a',

  accent: '#cdf24b',
  accentSoft: '#1d2410',
  accentInk: '#0b0d06',
  accentText: '#d4f56b',

  statusGood: '#34d399',
  statusWarning: '#fbbf24',
  statusCritical: '#fb7185',
  statusGoodSoft: '#0f2a21',
  statusWarningSoft: '#2c2210',
  statusCriticalSoft: '#331820',

  series: ['#cdf24b', '#60a5fa', '#fb923c'],

  divergePositive: '#b5df2e',
  divergeNegative: '#f43f5e',
  divergeNeutral: '#31343a',

  sequential: ['#1b1c1f', '#2b3a10', '#4a6a12', '#7ea51a', '#b5df2e', '#e3fa8f'],

  grid: '#1f2125',
  axis: '#31343a',
};

/**
 * A four-point spacing scale.
 *
 * Enough steps to build a hierarchy, few enough that two screens cannot drift a pixel
 * apart. Anything not on the scale is a deliberate exception and should look like one.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Type scale.
 *
 * `tabular: true` marks the styles used for columns of figures. Scores and statistics
 * have to line up vertically; a hero number should not be forced into tabular figures,
 * which look mechanical at large sizes.
 */
export const typography = {
  display: { fontSize: 44, lineHeight: 46, fontWeight: '700', letterSpacing: -1.6 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.7 },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '600', letterSpacing: -0.3 },
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 0.6 },
} as const;

/**
 * The smallest a control may be and still be reliably hittable.
 *
 * 44pt is Apple's floor and Android's is 48dp; taking the larger of the two costs
 * nothing and means one number covers both platforms.
 */
export const MIN_TOUCH_TARGET = 48;

/**
 * The em dash shown wherever a value is genuinely unknown.
 *
 * Never a zero. "No matches yet" and "a win rate of 0%" are different facts, and a
 * dashboard that renders them identically is lying about one of them.
 */
export const UNKNOWN = '—';
