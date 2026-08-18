import { darkPalette, lightPalette, MIN_TOUCH_TARGET, UNKNOWN, type Palette } from './tokens';

/**
 * The palettes are data, and data drifts. These checks are cheap and catch the two ways
 * a hand-maintained pair of themes goes wrong: a token added to one and forgotten in the
 * other, and a value pasted in a format nothing can parse.
 */

const themes: Array<[string, Palette]> = [
  ['light', lightPalette],
  ['dark', darkPalette],
];

const HEX = /^#[0-9a-f]{6}$/;

describe('palettes', () => {
  it('define exactly the same tokens in both themes', () => {
    expect(Object.keys(lightPalette).sort()).toEqual(Object.keys(darkPalette).sort());
  });

  it.each(themes)('%s uses six-digit lowercase hex throughout', (_name, palette) => {
    for (const [token, value] of Object.entries(palette)) {
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        expect(`${token}: ${entry}`).toMatch(new RegExp(`^${token}: ${HEX.source.slice(1, -1)}$`));
      }
    }
  });

  it.each(themes)(
    '%s keeps three categorical series and six sequential steps',
    (_name, palette) => {
      // The chart components index into these directly; a shorter array is a crash, and a
      // longer one is a chart cycling hues it was designed not to cycle.
      expect(palette.series).toHaveLength(3);
      expect(palette.sequential).toHaveLength(6);
    },
  );

  it.each(themes)('%s never reuses a status colour as a series colour', (_name, palette) => {
    const statuses = [palette.statusGood, palette.statusWarning, palette.statusCritical];
    for (const series of palette.series) {
      expect(statuses).not.toContain(series);
    }
  });

  it('inverts surface and text between the themes rather than repeating them', () => {
    // Catches the copy-paste failure where a theme is duplicated and half-edited.
    expect(lightPalette.surface0).not.toBe(darkPalette.surface0);
    expect(lightPalette.textPrimary).not.toBe(darkPalette.textPrimary);
  });
});

describe('constants', () => {
  it('keeps touch targets at or above the larger platform minimum', () => {
    // 44pt on iOS, 48dp on Android. One number covers both only if it is the larger.
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(48);
  });

  it('uses an em dash for unknown values, never a zero', () => {
    expect(UNKNOWN).toBe('—');
    expect(UNKNOWN).not.toBe('0');
  });
});
