import { DEFAULT_SCORING_RULES, SCORING_PRESETS, type ScoringRules } from '@badminton/contracts';
import { visibleGameCount, type GameInput } from './score-entry';

/**
 * How many game rows the form offers.
 *
 * Worth testing on its own because both ways of getting it wrong cost the user something
 * on every single match: too few rows and a three-game match cannot be recorded at all,
 * too many and there is a dead field to skip past every time.
 */

const bwf = DEFAULT_SCORING_RULES;

const game = (mine: string, theirs: string): GameInput => ({
  myScore: mine,
  opponentScore: theirs,
});

const empty: GameInput[] = [game('', ''), game('', ''), game('', ''), game('', '')];

describe('visibleGameCount in a best-of-three', () => {
  it('opens with the two games every match has', () => {
    expect(visibleGameCount(empty, bwf)).toBe(2);
  });

  it('does not offer a decider until the first two are split', () => {
    // Half-entered, so nothing is known yet.
    expect(visibleGameCount([game('21', '15'), game('', ''), game('', '')], bwf)).toBe(2);
  });

  it('offers a decider the moment the match is level', () => {
    expect(visibleGameCount([game('21', '15'), game('18', '21'), game('', '')], bwf)).toBe(3);
  });

  it('stops at two once the match has been won in two', () => {
    // A third row here is a field to skip past on the most common result there is.
    expect(visibleGameCount([game('21', '15'), game('21', '17'), game('', '')], bwf)).toBe(2);
  });

  it('stops at two once the match has been lost in two', () => {
    expect(visibleGameCount([game('15', '21'), game('17', '21'), game('', '')], bwf)).toBe(2);
  });

  it('stops at three once the decider is in', () => {
    expect(
      visibleGameCount([game('21', '15'), game('18', '21'), game('21', '19'), game('', '')], bwf),
    ).toBe(3);
  });

  it('never offers more games than the format allows', () => {
    expect(visibleGameCount(empty, bwf)).toBeLessThanOrEqual(bwf.bestOf);
  });
});

describe('visibleGameCount in other formats', () => {
  it('offers exactly one game in a single-game format', () => {
    const single = SCORING_PRESETS.BWF_SINGLE_GAME as ScoringRules;
    expect(visibleGameCount(empty, single)).toBe(1);
    expect(visibleGameCount([game('21', '15'), game('', '')], single)).toBe(1);
  });

  it('walks up to five games in a best-of-five', () => {
    const bestOfFive: ScoringRules = { ...bwf, bestOf: 5 };
    const games = [game('', ''), game('', ''), game('', ''), game('', ''), game('', '')];

    expect(visibleGameCount(games, bestOfFive)).toBe(3);

    const twoAll = [game('21', '15'), game('15', '21'), game('21', '18'), game('18', '21')];
    expect(visibleGameCount([...twoAll, game('', '')], bestOfFive)).toBe(5);
  });

  it('ends a best-of-five as soon as one side has three', () => {
    const bestOfFive: ScoringRules = { ...bwf, bestOf: 5 };
    const straight = [game('21', '15'), game('21', '16'), game('21', '17')];

    expect(visibleGameCount([...straight, game('', ''), game('', '')], bestOfFive)).toBe(3);
  });
});

describe('partially entered games', () => {
  it('treats a game with one score missing as not yet played', () => {
    // Counting it would make the form flicker between two and three rows as somebody
    // types, which is worse than either.
    expect(visibleGameCount([game('21', ''), game('', ''), game('', '')], bwf)).toBe(2);
  });

  it('ignores anything after the first incomplete game', () => {
    expect(visibleGameCount([game('', ''), game('21', '15'), game('21', '16')], bwf)).toBe(2);
  });
});
