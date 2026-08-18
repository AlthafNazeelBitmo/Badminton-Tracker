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

  accent: string;
  accentSoft: string;
  accentInk: string;

  /** Reserved for state. Never reused as a chart series colour. */
  statusGood: string;
  statusWarning: string;
  statusCritical: string;

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
  surface0: '#f4f4f1',
  surface1: '#fcfcfb',
  surface2: '#ffffff',

  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#6f6e69',

  border: '#e1e0d9',
  borderStrong: '#c3c2b7',

  accent: '#2a78d6',
  accentSoft: '#e8f0fc',
  accentInk: '#ffffff',

  statusGood: '#006300',
  statusWarning: '#8a5a00',
  statusCritical: '#b4302f',

  series: ['#2a78d6', '#eb6834', '#1baf7a'],

  divergePositive: '#2a78d6',
  divergeNegative: '#e34948',
  divergeNeutral: '#e1e0d9',

  sequential: ['#eeeeea', '#cde2fb', '#9ec5f4', '#5598e7', '#2a78d6', '#184f95'],

  grid: '#e1e0d9',
  axis: '#c3c2b7',
};

export const darkPalette: Palette = {
  surface0: '#0d0d0d',
  surface1: '#1a1a19',
  surface2: '#232322',

  textPrimary: '#ffffff',
  textSecondary: '#c3c2b7',
  textMuted: '#898781',

  border: '#2c2c2a',
  borderStrong: '#383835',

  accent: '#3987e5',
  accentSoft: '#16283f',
  accentInk: '#ffffff',

  statusGood: '#0ca30c',
  statusWarning: '#fab219',
  statusCritical: '#e66767',

  series: ['#3987e5', '#d95926', '#199e70'],

  divergePositive: '#3987e5',
  divergeNegative: '#e66767',
  divergeNeutral: '#383835',

  sequential: ['#232322', '#104281', '#184f95', '#256abf', '#3987e5', '#86b6ef'],

  grid: '#2c2c2a',
  axis: '#383835',
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
  sm: 6,
  md: 10,
  lg: 14,
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
  display: { fontSize: 40, lineHeight: 44, fontWeight: '700' },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '600' },
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 15, fontWeight: '600' },
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
