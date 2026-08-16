# Badminton Tracker

A personal badminton performance platform. It records every match you play and turns
the raw scorelines into an honest picture of how you are actually doing — win rate over
time, head-to-head records, which partnerships work, where you lose the close ones, and
whether you are improving.

The design goal is narrow and specific: **recording a match must be faster than opening
a spreadsheet.** Finish a match, open the app, tap in the scores, done. Everything else
in the product is downstream of that.

---

## What it does

**Recording**

- Quick match entry: format, opponents and scores on one screen, saved in one request.
- Opponents and partners resolved by name — type someone new and they are created.
- Singles, doubles and mixed doubles, with configurable scoring formats (nothing about
  "21 points, best of 3" is hardcoded).
- Badminton-aware validation: 21-19 and 30-29 are accepted, 21-20 and 23-19 are not.
- CSV import with a row-by-row preview, and CSV/JSON export of everything.

**Analysis**

- Dashboard answering, in order: how much am I playing, am I winning, am I improving.
- Win rate, game win rate, point win rate and point differential over time.
- Head-to-head records per opponent and per doubles partner.
- Performance by venue, discipline, session type and self-reported difficulty.
- Situational analysis: close matches, deciding games, comebacks, collapses, blowouts.
- A documented consistency score, and performance by position within a session.
- Personal records, achievements, goals with live progress and an Elo-style rating.
- Insights generated from your data, each carrying the numbers behind it.

---

## Architecture at a glance

```
apps/web    Next.js 15 · React 19 · Tailwind      the interface
apps/api    NestJS 11 · Prisma · PostgreSQL 16    the authority
packages/contracts    zod schemas, enums, scoring rules — shared by both
packages/analytics    pure, deterministic analytics — no framework, no database
```

Three principles run through the whole codebase:

**Raw match data is the source of truth.** Games hold the scores; every statistic is
derived from them. A handful of derived values are stored for query performance, and
`npm run recompute` rebuilds them from the games at any time.

**One analytics engine.** Every breakdown — by opponent, partner, venue, month, session
— is the same `aggregate()` function applied to a filtered slice of the same records.
"Win rate" cannot mean one thing on the dashboard and another in a report.

**Unknown is not zero.** A rate with a zero denominator is `null` everywhere, and the
interface renders it as an em dash. A player with no matches has an _unknown_ win rate,
not a 0% one.

Full detail in [`docs/architecture.md`](docs/architecture.md).

---

## Getting started

### Requirements

- Node.js 20.11+ (22 recommended)
- PostgreSQL 16, or Docker

### 1. Install and configure

```bash
git clone <repository-url> badminton-tracker
cd badminton-tracker
npm install

cp .env.example .env
```

Generate the two signing secrets and paste them into `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Every variable is documented inline in [`.env.example`](.env.example). The API validates
its whole configuration at boot and refuses to start with a bad one, rather than failing
later under load.

### 2. Start PostgreSQL

```bash
docker compose up -d db
```

Or point `DATABASE_URL` at an existing PostgreSQL 16 instance. The integration suite
needs a second database; `TEST_DATABASE_URL` must contain the word `test`, which is
enforced, because the suite truncates every table between files.

### 3. Prepare the database

```bash
npm run build:packages          # the shared packages the API imports
npm run db:generate             # Prisma client
npm run db:migrate              # apply migrations
npm run db:seed                 # optional: 237 matches of demo data
```

The seed creates `demo@demo.badminton.local` / `demo-badminton-2026`. It is clearly
marked demo data and refuses to run against a production database.

### 4. Run it

```bash
npm run dev:api     # http://localhost:4000  (docs at /api/docs)
npm run dev:web     # http://localhost:3000
```

Or the whole stack in containers:

```bash
docker compose up --build
```

---

## Commands

| Command                                          | What it does                                  |
| ------------------------------------------------ | --------------------------------------------- |
| `npm run dev:api` / `npm run dev:web`            | Development servers with hot reload           |
| `npm run build`                                  | Build every workspace                         |
| `npm run typecheck`                              | TypeScript across the monorepo                |
| `npm run lint` / `npm run format`                | ESLint / Prettier                             |
| `npm test`                                       | Unit tests (no database needed)               |
| `npm run test:e2e -w @badminton/api`             | API integration tests against real PostgreSQL |
| `npm run test:e2e -w @badminton/web`             | Browser journeys via Playwright               |
| `npm run db:migrate`                             | Create and apply a migration                  |
| `npm run db:deploy`                              | Apply committed migrations (production)       |
| `npm run db:seed`                                | Load demo data                                |
| `npm run db:studio`                              | Prisma Studio                                 |
| `npm run recompute -w @badminton/api`            | Rebuild derived data from raw games           |
| `npm run recompute -w @badminton/api -- --check` | Report drift without writing                  |

---

## Testing

Three layers, each with a job the others cannot do:

- **Unit** (`packages/analytics`, `apps/api/src`) — the formulas. Scoring rules, win rate,
  streaks, Elo, records, CSV parsing. No database, milliseconds to run.
- **Integration** (`apps/api/test`) — boots the real application against real PostgreSQL
  and exercises the HTTP surface: authentication, ownership isolation, match correctness,
  analytics, import/export.
- **End-to-end** (`apps/web/e2e`) — a real browser against the real API and database, on
  desktop and mobile viewports.

```bash
npm test                                  # unit
npm run test:e2e -w @badminton/api        # integration (needs TEST_DATABASE_URL)
npm run test:e2e -w @badminton/web        # browser (needs both servers running)
```

See [`docs/testing.md`](docs/testing.md).

---

## Documentation

| Document                                | Covers                                                                |
| --------------------------------------- | --------------------------------------------------------------------- |
| [architecture.md](docs/architecture.md) | System design, module layout, data flow, extension points             |
| [database.md](docs/database.md)         | Schema, entity relationships, indexes, migrations, backups            |
| [api.md](docs/api.md)                   | Endpoints, conventions, errors, pagination, filtering                 |
| [analytics.md](docs/analytics.md)       | **Every formula, written out** — win rate, consistency, Elo, insights |
| [security.md](docs/security.md)         | Threat model, controls, pre-deployment checklist, known gaps          |
| [deployment.md](docs/deployment.md)     | Recommended production architecture and why, environments, backups    |
| [testing.md](docs/testing.md)           | Strategy, how to run each layer, what is covered                      |
| [roadmap.md](docs/roadmap.md)           | What is built, what is deliberately deferred                          |

---

## Status

Built and verified: the analytics engine (92 unit tests), the API (84 integration tests
against real PostgreSQL, 14 unit tests), and the web app (5 browser journeys on two
viewports). Migrations, seed data and the recompute tool all run against a live database.

Not yet implemented, and honestly marked as such rather than stubbed:

- **Email delivery.** Verification and password-reset tokens are generated, stored
  hashed and consumed correctly; in development the link is logged to the console. A
  transport needs wiring before those flows work for real users.
- **Avatar uploads.** The schema carries `avatarUrl`; there is no upload endpoint.
- **Social features.** Friends, leaderboards, clubs and public profiles are designed for
  — `Player.linkedUserId` and the visibility enum exist — but not built.

See [`docs/roadmap.md`](docs/roadmap.md) for the full picture.

---

## Licence

MIT
