import { describe, expect, it } from 'vitest';
import {
  EM_DASH,
  duration,
  initials,
  joinNames,
  number,
  percent,
  scoreline,
  signed,
  titleCase,
  totalTime,
} from './format';

/**
 * These helpers render every number the user sees, so the rule they exist to enforce is
 * worth testing directly: **unknown is an em dash, never zero**. A player with no
 * matches has an unknown win rate, and showing 0% would be a false statement about their
 * record.
 */
describe('unknown values render as an em dash', () => {
  it.each([
    ['percent', percent(null)],
    ['number', number(null)],
    ['signed', signed(null)],
    ['duration', duration(null)],
    ['totalTime', totalTime(null)],
  ])('%s(null)', (_label, result) => {
    expect(result).toBe(EM_DASH);
  });

  it('distinguishes an unknown rate from a genuine zero', () => {
    expect(percent(null)).toBe(EM_DASH);
    expect(percent(0)).toBe('0.0%');
  });

  it('treats undefined the same as null', () => {
    expect(percent(undefined)).toBe(EM_DASH);
    expect(signed(undefined)).toBe(EM_DASH);
  });
});

describe('percent', () => {
  it('renders one decimal by default', () => {
    expect(percent(66.66666)).toBe('66.7%');
    expect(percent(100)).toBe('100.0%');
  });
});

describe('signed', () => {
  it('always shows the direction, because the sign is the message', () => {
    expect(signed(42)).toBe('+42');
    expect(signed(-42)).toBe('−42');
    expect(signed(0)).toBe('0');
  });

  it('uses a true minus sign rather than a hyphen', () => {
    // U+2212, so a negative differential is not mistaken for a range separator.
    expect(signed(-7)).toContain('−');
    expect(signed(-7)).not.toContain('-');
  });
});

describe('duration', () => {
  it('renders minutes below an hour', () => {
    expect(duration(1800)).toBe('30 min');
  });

  it('renders hours and minutes above an hour', () => {
    expect(duration(3600)).toBe('1 h');
    expect(duration(5400)).toBe('1 h 30 min');
  });

  it('treats zero as unknown, because an untimed match is not a zero-length one', () => {
    expect(duration(0)).toBe(EM_DASH);
  });
});

describe('totalTime', () => {
  it('scales the unit to the magnitude', () => {
    expect(totalTime(1800)).toBe('30 min');
    expect(totalTime(3600 * 58.1)).toBe('58.1 h');
    expect(totalTime(3600 * 250)).toBe('250 h');
  });
});

describe('joinNames', () => {
  it('reads as prose rather than a list', () => {
    expect(joinNames(['John'])).toBe('John');
    expect(joinNames(['John', 'Ahmed'])).toBe('John & Ahmed');
    expect(joinNames(['John', 'Ahmed', 'Priya'])).toBe('John, Ahmed & Priya');
  });

  it('does not render an empty side as blank', () => {
    expect(joinNames([])).toBe('Unknown');
  });
});

describe('scoreline', () => {
  it('joins games with an en dash between the scores', () => {
    expect(
      scoreline([
        { myScore: 21, opponentScore: 18 },
        { myScore: 19, opponentScore: 21 },
        { myScore: 21, opponentScore: 16 },
      ]),
    ).toBe('21–18, 19–21, 21–16');
  });
});

describe('initials', () => {
  it('takes at most two initials', () => {
    expect(initials('John Carter')).toBe('JC');
    expect(initials('Priya')).toBe('P');
    expect(initials('Ana Maria Silva Costa')).toBe('AM');
  });

  it('survives extra whitespace', () => {
    expect(initials('  John   Carter  ')).toBe('JC');
  });
});

describe('titleCase', () => {
  it('turns an enum member into a label', () => {
    expect(titleCase('REGULAR_OPPONENT')).toBe('Regular Opponent');
    expect(titleCase('SINGLES')).toBe('Singles');
  });
});
