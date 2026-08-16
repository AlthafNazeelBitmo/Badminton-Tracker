# Analytics

Every formula the platform uses, written out. If a number appears in the interface, its
definition is on this page.

The rule this document exists to enforce: **the backend is the only place statistics are
computed.** The web client renders what the API returns and never recalculates. That is
why "average winning margin" cannot mean one thing on the dashboard and another in a
report.

All of it lives in [`packages/analytics`](../packages/analytics) as pure functions with
no framework and no database, which is what makes it unit-testable and recomputable.

---

## The two rules underneath everything

### 1. An unknown rate is `null`, never `0`

A rate with a zero denominator is unknown. A player you have never faced does not have a
0% win rate — you do not know what it is. Every rate in the API is `number | null`, and
the interface renders `null` as an em dash.

This matters more than it sounds. Treating unknown as zero drags averages toward zero,
invents downward trends, and puts opponents you have never played at the bottom of a
"worst results" list.

### 2. Periods with no play are omitted, not zeroed

A month you did not play is absent from a trend series. Plotting it as 0% would draw a
collapse in form that never happened.

The exception is the activity heatmap, where "no sessions on this day" is a real fact
about that day and is drawn as an empty cell.

---

## Core aggregates

Computed by `aggregate()` in
[`packages/analytics/src/aggregate.ts`](../packages/analytics/src/aggregate.ts). This is
the single aggregation function; every breakdown is it applied to a filtered slice.

| Measure                 | Formula                                                |
| ----------------------- | ------------------------------------------------------ |
| Win rate                | `wins / matches × 100`                                 |
| Game win rate           | `gamesWon / gamesPlayed × 100`                         |
| Point win rate          | `pointsScored / (pointsScored + pointsConceded) × 100` |
| Point differential      | `pointsScored − pointsConceded`                        |
| Average points per game | `pointsScored / gamesPlayed`                           |
| Average winning margin  | mean margin of **games won**                           |
| Average losing margin   | mean margin of **games lost**                          |
| Average match duration  | `playingSeconds / matchesWithADuration`                |

Two details worth stating explicitly:

**Margins are measured per game, not per match.** A 2-0 win and a 2-1 win are then
comparable, and a single blowout game does not distort a match-level average.

**Untimed matches are excluded from duration averages**, not counted as zero. Duration is
optional, and most people do not record it.

Percentages are rounded to one decimal, averages to two. Rounding happens once, at the
edge, so API responses are stable and snapshot-testable.

---

## Match derivation

`deriveMatch()` in [`derive.ts`](../packages/analytics/src/derive.ts) is the single place
a match result is decided. Nothing else in the platform infers a win from anything else —
the write path and the recompute command both call it.

| Property        | Definition                                                             |
| --------------- | ---------------------------------------------------------------------- |
| `result`        | `WIN` if more games won than lost, `LOSS` if fewer, else `DRAW`        |
| `isComeback`    | Lost the first game, won the match                                     |
| `isCollapse`    | Won the first game, lost the match                                     |
| `wentToDecider` | Format allows more than one game and the last possible game was played |
| `isClutch`      | **Every** game finished within 3 points                                |
| `isBlowout`     | **Every** game finished by 11 points or more                           |

`isClutch` and `isBlowout` require _every_ game to qualify, so a match of one 21-19 and
one 21-5 is neither. They describe the whole scoreline, not its most memorable moment.

Thresholds live in `ANALYTICS_CONSTANTS` so this document, the API and the tests cannot
drift apart.

---

## Streaks

`computeStreaks()` walks matches in chronological order (ties inside a session broken by
recorded match order, so the result is deterministic).

- A draw **breaks** a streak without starting one.
- `current` is signed: `+5` is a five-match winning run, `−2` a two-match losing run.
  One field drives the interface.
- `bestWinStreak` and `worstLossStreak` are the longest runs anywhere in the window, not
  only the current one.

---

## Consistency score

**Method identifier: `consistency-v1`** (published in the API response, so a change is
visible to clients).

1. Take the point margin of every game in the window, signed from your perspective:
   `+3` for 21-18, `−4` for 17-21.
2. Compute the population standard deviation σ of those margins.
3. `score = 100 × (1 − σ / 21)`, clamped to 0–100.

σ = 0 (every game by an identical margin) scores 100. σ ≥ 21 — a full game's worth of
points of swing — scores 0.

**It measures repeatability, not strength.** A player who loses 15-21 every single time
scores highly, and should: their results are extremely consistent. Read it alongside win
rate, never instead of it.

Withheld below 5 games; the API returns `null` with the sample size rather than a number
built on nothing.

---

## Situational analysis

| Measure              | Definition                                            |
| -------------------- | ----------------------------------------------------- |
| Clutch               | Matches where every game finished within 3 points     |
| Blowout              | Matches where every game finished by 11+ points       |
| Deciders             | Matches that reached the final game the format allows |
| After winning game 1 | Win rate in matches where the first game was won      |
| After losing game 1  | Win rate in matches where the first game was lost     |

The gap between the last two is often the most actionable number in the product: it says
how much a fast start is worth to _you_ specifically.

---

## Fatigue analysis

Matches are bucketed by `orderInSession` — position within a session — so the fifth match
of every session is compared with the first. Sessions of different lengths handle
naturally: a three-match session simply contributes nothing to buckets 4 and 5.

`earlyVsLateWinRateDelta` compares the first third of positions with the last third,
weighted by matches played. A decline of 10+ percentage points is reported as
_"performance appears to decline later in sessions"_.

**This describes scorelines, not physiology.** The platform never claims a medical or
physiological cause, and the wording is deliberately hedged. Who you play later in a
session is part of the effect too — courts free up, stronger players stay on.

Withheld below 5 distinct sessions.

---

## Rating (Elo)

> **This is an estimated application rating derived only from matches recorded in this
> app. It is not a BWF ranking, a club grading, or any official measure.** Every surface
> that displays it carries that disclaimer, and the API returns it in the payload.

Standard Elo, in [`rating.ts`](../packages/analytics/src/rating.ts):

```
expected = 1 / (1 + 10^((opponentRating − playerRating) / 400))
delta    = K × (actual − expected)        actual ∈ {1, 0.5, 0}
```

| Parameter       | Value    | Why                                               |
| --------------- | -------- | ------------------------------------------------- |
| Starting rating | 1200     | Conventional Elo baseline                         |
| K-factor        | 24       | Stable once a rating has settled                  |
| Provisional K   | 48       | First 10 matches, so new ratings converge quickly |
| Bounds          | 100–3500 | Guards against runaway values                     |

**Doubles.** A side's rating is the mean of its players' ratings, and each player on the
side receives the full delta. Averaging stops a strong player being dragged down for
partnering a weaker one more than the result justifies; applying the full delta keeps
individual ratings responsive.

**Uncertainty** is reported as a deviation alongside the rating rather than folded into
it: `max(50, 350 − matchesRated × 12)`. A rating of 1240 ± 350 and one of 1240 ± 50 are
very different claims, and the interface shows the difference.

**Ratings are replayed from scratch** over the entire match history rather than updated
incrementally. That costs more per write, but it is the only approach where editing a
match from six months ago yields a correct rating today, and where the model can be
re-tuned without a data migration. For the volumes a personal tracker produces this is a
few milliseconds.

---

## Insights

Generated in [`insights.ts`](../packages/analytics/src/insights.ts). Three rules are
enforced by construction:

**1. No fabrication.** Every sentence is built from numbers computed in that file, and
those numbers are attached to the response as `evidence`. Any claim can be checked
against the data that produced it.

**2. Minimum samples.** A generator that cannot meet its threshold returns nothing rather
than a shaky claim. Most require 5 matches; some require considerably more.

**3. Separated claim strength.** Every insight is labelled, and nothing is ever promoted
from one level to the next:

| Kind             | Means              | Example                                                   |
| ---------------- | ------------------ | --------------------------------------------------------- |
| `OBSERVATION`    | What the data says | "You have won 3 of your last 10 matches."                 |
| `INTERPRETATION` | A reading of it    | "Your doubles win rate is 17 points higher than singles." |
| `RECOMMENDATION` | A suggested focus  | "Deciding games look like your biggest opportunity."      |

Interpretations name their confounders in the text — _"different opposition in each
format can explain part of this gap"_ — rather than presenting a correlation as a cause.

---

## Tag correlations

Win rate for matches carrying each performance tag, and the delta against the overall
rate.

These are **associations, not causes**, and the interface says so. Tags are applied after
a match, so a losing match is more likely to be tagged "unforced errors" — the tag partly
reflects the result rather than explaining it.

---

## Time-zone handling

Everything is stored in UTC. Bucketing projects each instant into the user's IANA time
zone before deciding which day, week, month or year it belongs to, using
`Intl.DateTimeFormat` — correct across DST transitions, and with no date-library
dependency.

Weeks are ISO weeks (Monday start). A match at 23:30 on 31 January belongs to January for
someone in Auckland and to January for someone in Honolulu — each in their own calendar.
Both cases are covered by tests.

---

## What is stored versus computed

The platform's rule is that raw match data is the source of truth and analytics are
derived. Two exceptions are stored, both deliberately:

| Stored                                                            | Why                                                                                                          | How it stays correct                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `Match.result`, `gamesWon`, `pointsScored`, `pointDifferential` … | So the match list can filter by result and sort by margin **in the database** rather than loading every game | Written by `deriveMatch()` in the same transaction as the games |
| `RatingEvent` rows and `Player.rating`                            | So rating history renders without replaying every request                                                    | Rebuilt wholesale by the rating replay whenever matches change  |

Everything else — win rates, breakdowns, records, streaks, goal progress, achievements
progress, insights — is computed per request and never stored.

`npm run recompute -w @badminton/api` rebuilds both stored projections from the raw
games. `--check` reports drift without writing. This is the invalidation mechanism that
makes storing anything derived defensible; run it after changing a formula, after a bulk
import, or whenever a stored value is suspect.

---

## Changing a formula

1. Change the pure function in `packages/analytics`.
2. Update its unit tests — they encode the current behaviour deliberately.
3. Update this document.
4. If it affects a stored projection, bump its method identifier (as
   `consistency-v1` does) and run `npm run recompute`.

No migration is needed for anything computed per request, which is most of it. That is
the payoff for keeping raw data as the source of truth.
