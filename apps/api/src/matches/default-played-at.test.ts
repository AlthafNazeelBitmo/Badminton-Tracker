import { describe, expect, it } from 'vitest';
import { defaultPlayedAt } from './matches.service';

/**
 * A match saved without a time is placed in the evening of its session's date — unless
 * that evening has not happened yet, which would hide the match from every analytics
 * range (they all end at "now") until it had.
 */
describe('defaultPlayedAt', () => {
  const sessionDate = new Date('2026-11-22T00:00:00Z');

  it('uses the evening of a past session date', () => {
    const now = new Date('2026-11-25T09:00:00Z');
    expect(defaultPlayedAt(sessionDate, now).toISOString()).toBe('2026-11-22T18:00:00.000Z');
  });

  it('uses the evening once it has passed on the same day', () => {
    const now = new Date('2026-11-22T20:15:00Z');
    expect(defaultPlayedAt(sessionDate, now).toISOString()).toBe('2026-11-22T18:00:00.000Z');
  });

  it('never stamps a match recorded today in the future', () => {
    const now = new Date('2026-11-22T14:30:00Z');
    expect(defaultPlayedAt(sessionDate, now)).toEqual(now);
  });

  it('leaves a deliberately future-dated session at its evening', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    expect(defaultPlayedAt(sessionDate, now).toISOString()).toBe('2026-11-22T18:00:00.000Z');
  });
});
