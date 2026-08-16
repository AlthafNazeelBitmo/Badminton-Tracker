# Testing

Three layers, each doing something the others cannot. The aim is meaningful coverage of
the things that would actually hurt, not a coverage percentage.

| Layer       | Where                                    | Needs        | Speed | Covers                                      |
| ----------- | ---------------------------------------- | ------------ | ----- | ------------------------------------------- |
| Unit        | `packages/analytics/src`, `apps/api/src` | Nothing      | ~1s   | Formulas, scoring rules, CSV                |
| Integration | `apps/api/test`                          | PostgreSQL   | ~40s  | HTTP surface, auth, ownership, transactions |
| End-to-end  | `apps/web/e2e`                           | Both servers | ~10s  | Real browser journeys                       |

```bash
npm test                                # unit, everywhere
npm run test:e2e -w @badminton/api      # integration
npm run test:e2e -w @badminton/web      # browser
```

---

## Unit tests — 106 tests

**`packages/analytics` (92).** The formulas, in isolation. These are the tests that
matter most, because every number in the product comes from here.

- **Scoring rules (35).** A table of legal and illegal scores under BWF rules: 21-0,
  21-19, 22-20, 30-29 and 30-28 accepted; 21-20, 23-19, 21-21, 19-17 and 31-29 rejected.
  Then the same again under a 15-point social format and a sudden-death format, because
  "not hardcoded to 21" is a claim that needs proving.
- **Aggregation (20).** Every formula against hand-checked numbers, including the two
  rules that are easy to get wrong: unknown rates are `null` rather than `0`, and untimed
  matches are excluded from duration averages rather than counted as zero.
- **Situational and trends (17).** Comebacks, collapses, clutch, blowout, consistency,
  fatigue, and time-zone bucketing — a match at 05:30 UTC on 1 February belongs to
  February in Auckland and January in Honolulu.
- **Rating and records (20).** Elo symmetry, provisional K-factor, diminishing returns for
  beating the same opponent repeatedly, rating bounds, and record detection.

**`apps/api` (14).** The CSV reader and writer: RFC 4180 quoting, embedded commas and
newlines, escaped quotes, CRLF, byte-order marks, formula-injection neutralisation, and
the rule that negative numbers must survive it intact.

Tests import package **source**, not `dist`, so a stale build cannot mask a failure.

---

## Integration tests — 84 tests

These boot the real application — the same modules, guards, pipes and exception filter
production uses — against a real PostgreSQL database. Tests that stub the container prove
the stub works; these prove the application works.

Requires `TEST_DATABASE_URL`. The suite **refuses to run** unless it contains "test",
because it truncates every table between files.

Migrations are applied with `prisma migrate deploy` rather than `db push`, so CI verifies
the committed migrations rather than an approximation of them.

**Authentication (17)** — registration creating profile and self-player atomically;
passwords never stored in plaintext; cookie attributes (`httpOnly`, `SameSite`, the
refresh cookie's path scope); identical responses for unknown email and wrong password;
refresh rotation; **family-wide revocation when a rotated token is replayed**; password
change ending every session.

**Matches (25)** — quick entry creating session, venue, players and match in one request;
session reuse for a second match the same day; case-insensitive name resolution; the full
table of invalid scorelines rejected with nothing written; custom formats; derived values
computed from games and **not** from client-supplied fields; renumbering after deletion;
filtering and sorting.

**Ownership isolation (5, inside the above)** — a second account cannot list, fetch,
delete, export or reference the first account's matches, players, venues or sessions, and
gets 404 rather than 403.

**Analytics (29)** — headline statistics against hand-checked numbers; unknown-not-zero
for an empty account; date presets and rejection of invalid ranges and time zones;
monthly bucketing that omits empty months; a partner never counted as an opponent;
situational analysis; rating recomputation after a deletion restoring the starting value
exactly; goals computed rather than stored; idempotent achievements; and a report that
agrees with the overview it summarises.

**Import/export (13)** — preview writing nothing; each invalid row reported with its
spreadsheet row number and reason; duplicate detection within a file and against stored
matches; committing only accepted rows; negative numbers surviving CSV export; and a
full **export → import round trip**, including the shipped template.

---

## End-to-end tests — 5 journeys × 2 viewports

Playwright against a real browser, the real API and a real database. Desktop Chrome and
Pixel 7, because this application is used on a phone at the side of a court.

1. **Register → record → see it in the analytics.** The whole product in one test.
2. **An impossible score is rejected before saving**, with the save button disabled.
3. **A signed-out visitor is redirected** to login.
4. **Bad credentials** produce the non-enumerating message.
5. **Accessibility basics** — exactly one `h1` per page and a working skip link.

The API under test runs with `RATE_LIMIT_ENABLED=false`, because the suite registers
many accounts and the real 5-per-hour limit would reject them. Production configuration
refuses to start with that switched off, so the escape hatch cannot leak.

### Running locally

```bash
# terminal 1
npm run dev:api

# terminal 2
npm run dev:web

# terminal 3
npm run test:e2e -w @badminton/web
```

---

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs four jobs in parallel:

| Job           | Does                                                                           |
| ------------- | ------------------------------------------------------------------------------ |
| `static`      | Formatting, lint, types, unit tests — fastest feedback first                   |
| `integration` | Migrations against PostgreSQL, schema/migration drift check, integration suite |
| `e2e`         | Builds both apps, starts them, runs Playwright                                 |
| `docker`      | Builds both images with layer caching                                          |

A final `ci` job depends on all four, so branch protection points at one required check
and adding a job later does not mean editing repository settings.

The drift check is worth calling out: `prisma migrate diff --exit-code` fails if the
schema and the migrations have diverged. A schema edited without a matching migration is a
deployment that will fail in production — caught before it merges.

---

## What is deliberately not tested

- **Third-party libraries.** Prisma, Nest and Next are tested by their maintainers.
- **Trivial getters and mappers.** Covered incidentally by the tests that use them.
- **Exact chart pixels.** Brittle and low value; the data feeding the charts is tested
  instead.
- **Coverage percentage as a target.** Chasing a number produces tests written to touch
  lines rather than to catch defects.

---

## Adding tests

**A new formula** → unit test in `packages/analytics`, with the edge cases: zero
denominator, single sample, and the boundary the threshold sits on.

**A new endpoint** → integration test covering the happy path, one validation failure,
and **ownership isolation** (another user must not reach it).

**A new user-facing flow** → an E2E journey only if it is something a user does regularly.
Reserve this layer for the handful of paths that matter; it is the slowest and most
brittle.

---

## Bugs these tests have already caught

Every one of these was found by running the suite, not by reading the code:

| Bug                                                                                                                                                 | Found by                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Zod validation returning **500 instead of 422** whenever the schema package and the pipe resolved different copies of zod (the dual-package hazard) | Integration                |
| Partners and opponents resolved concurrently in one transaction, racing on the unique name constraint and surfacing a confusing 409                 | Integration                |
| CSV headers lower-cased on parse but read back as camelCase — `durationMinutes` and `sessionType` silently dropped from every import                | Integration                |
| The shipped CSV template missing two empty game columns, shifting every later value into the wrong field                                            | Integration                |
| CSV export quoting negative numbers as `'-7`, corrupting every point differential                                                                   | Integration                |
| **Non-deterministic participant order** — a doubles pair rendering as "John & Priya" one request and "Priya & John" the next                        | Integration (as flakiness) |
| A newly created player rendering as "Unknown" until the cached list revalidated                                                                     | E2E                        |
| Recent-player suggestions pushing the score fields below the fold on a phone                                                                        | E2E screenshot             |

The last two are the argument for testing in a real browser: neither is visible from the
code, and both would have shipped.
