# Database

PostgreSQL 16, accessed through Prisma. The schema lives in
[`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) with the rationale
for each decision in comments beside it.

---

## Entity relationships

```
User ─┬─ PlayerProfile        (1:1)  preferences, default scoring format
      ├─ RefreshToken         (1:n)  hashed, rotating, grouped into families
      ├─ OneTimeToken         (1:n)  password reset / email verification
      ├─ Player               (1:n)  the address book, including the user themselves
      ├─ Venue                (1:n)
      ├─ Session              (1:n)  one visit to a court
      ├─ Match                (1:n)
      ├─ Goal                 (1:n)
      ├─ UserAchievement      (1:n)  only the unlock; the catalogue lives in code
      ├─ RatingEvent          (1:n)  a projection, rebuilt from matches
      ├─ Notification         (1:n)
      └─ AuditLog             (1:n)

Session ─── Match ─┬─ Game               (1:n)  the source of truth
                   ├─ MatchParticipant   (1:n)  who played, and on which side
                   └─ MatchTag           (1:n)

Venue ─── Session      (1:n, SET NULL — losing a venue never loses a match)
Player ─── MatchParticipant  (1:n)
```

---

## The five decisions that shape everything

### 1. Games are the source of truth

`Game` holds `myScore` and `opponentScore`. Every statistic in the platform is derived
from those rows. Delete the analytics and they can be rebuilt; delete the games and the
data is gone.

### 2. `HOME` is always the user's side

`MatchParticipant.side` is `HOME` for the user's side, `AWAY` for the opposition, without
exception. Analytics queries become symmetrical: opponents are `AWAY` participants,
partners are `HOME` participants that are not the user. The invariant is enforced on
write.

### 3. A person is one row

`Player` is a person in one user's address book. Opponent versus partner is a property of
the match, never of the person, so "my record against John" and "my record with John" are
both answerable from the same row.

`normalizedName` (case-folded, whitespace-collapsed) is unique per user. Typing "john
carter" during quick entry finds the existing "John Carter" rather than creating a
duplicate. Accents are preserved — "Muñoz" and "Munoz" may be different people, and
merging them is not the software's call.

### 4. Scoring format is stored per match

`pointsToWin`, `winBy`, `maxPoints` and `bestOf` live on `Match`. Changing your default
never rewrites history, and a 15-point social game is validated against its own rules.

### 5. Every user-owned row carries `userId`

Indexed on every table. Single-user in practice, multi-tenant in structure.

---

## Derived columns

`Match` stores `result`, `gamesWon`, `gamesLost`, `pointsScored`, `pointsConceded` and
`pointDifferential`. These are derived from the games and would normally violate the rule
above.

**Why they are stored:** the match list filters by result and sorts by margin. Without
these columns every such query would load every game of every match and sort in
application memory — the difference between an index scan and a full table read.

**How they stay correct:** written by `deriveMatch()` in the same transaction as the
games, never supplied by a client, and rebuildable at any time:

```bash
npm run recompute -w @badminton/api            # rebuild
npm run recompute -w @badminton/api -- --check # report drift, write nothing
```

`RatingEvent` rows and `Player.rating` are the same kind of thing: a projection of match
data, rebuilt wholesale by the rating replay.

---

## Indexes

Chosen for the queries the product actually makes, not speculatively.

| Table                | Index                                 | Serves                               |
| -------------------- | ------------------------------------- | ------------------------------------ |
| `matches`            | `(userId, playedAt DESC)`             | Match history, the most common query |
| `matches`            | `(userId, discipline, playedAt DESC)` | Filtering by format                  |
| `matches`            | `(userId, result)`                    | Filtering wins or losses             |
| `matches`            | `(sessionId, orderInSession)` unique  | Session ordering, fatigue analysis   |
| `match_participants` | `(playerId, side)`                    | Head-to-head and partnership lookups |
| `match_participants` | `(matchId, playerId)` unique          | One appearance per person per match  |
| `sessions`           | `(userId, date DESC)`                 | Calendar and session list            |
| `players`            | `(userId, normalizedName)` unique     | Name resolution during quick entry   |
| `venues`             | `(userId, normalizedName)` unique     | Venue resolution                     |
| `games`              | `(matchId, gameNumber)` unique        | Ordered game retrieval               |
| `refresh_tokens`     | `tokenHash` unique, `familyId`        | Token lookup and family revocation   |

Deliberately **not** indexed: `notes` (searched rarely, on small tables), `difficulty` and
`energyLevel` (low cardinality, poor selectivity), most `createdAt` columns.

---

## Referential integrity

| Relationship                         | On delete                       | Why                                                                                             |
| ------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| `User` → everything                  | `CASCADE`                       | Deleting an account removes its data                                                            |
| `Session` → `Match`                  | `CASCADE`                       | Deleting a session means deleting its matches; the API reports how many                         |
| `Match` → `Game`, participants, tags | `CASCADE`                       | A game without a match is meaningless                                                           |
| `Venue` → `Session`                  | `SET NULL`                      | **Deleting a venue loses the location, never a match**                                          |
| `Player` → `MatchParticipant`        | `CASCADE` at the database level | Guarded in the service: deleting a player who has played is refused, with merge offered instead |

That last row is the important one. Cascade is correct at the database level, but a user
clicking "delete player" does not expect to lose eight months of matches — so the service
refuses and suggests a merge. History is the asset this product exists to protect.

---

## Migrations

```bash
npm run db:migrate -w @badminton/api      # create and apply (development)
npm run db:deploy -w @badminton/api       # apply committed migrations (production)
npm run db:reset  -w @badminton/api       # drop, recreate, re-seed (development only)
```

Rules:

1. Never edit production schema by hand. `migrate deploy` in the deployment pipeline is
   the only path.
2. Never edit a migration that has been applied anywhere. Write a new one.
3. CI runs `prisma migrate diff --exit-code` and fails if the schema and migrations have
   diverged — a schema edited without a matching migration is a deployment that will fail
   in production, caught before it merges.

### Expand, migrate, contract

For a change that would break a running old version, deploy in three steps rather than
one: add the new column as nullable, backfill and start writing to both, then drop the
old column in a later release. Zero-downtime deployment needs the old and new code to
work against the same schema for one release.

---

## Seed data

```bash
npm run db:seed -w @badminton/api
```

Creates `demo@demo.badminton.local` / `demo-badminton-2026` with 237 matches across eight
months, generated to exercise the analytics rather than to look tidy: winning and losing
streaks, comebacks, deuce games, blowouts, a deliberate decline late in long sessions and
a singles/doubles gap.

Safeguards, because seed data reaching production is a real failure mode:

- Every seeded account uses the `@demo.badminton.local` domain.
- Every record carries a "DEMO DATA" marker in its notes.
- The script refuses to run when `NODE_ENV=production` or when `DATABASE_URL` looks like a
  production database.
- Re-seeding deletes only the demo account, never anything else.

Ratings are produced by the same replay the API uses, so the seed cannot create a state
the application would never produce itself.

---

## Backups

**The production database must be managed, with automated backups.** A PostgreSQL
container next to the application is a development convenience, not a production
architecture — see [deployment.md](deployment.md).

| Setting                | Recommendation                                   |
| ---------------------- | ------------------------------------------------ |
| Automated backups      | Daily, retained 30 days                          |
| Point-in-time recovery | Enabled, 7-day window                            |
| Restore rehearsal      | Quarterly, into a scratch database               |
| Pre-migration          | Manual snapshot before any destructive migration |

An untested backup is a hypothesis. Restore one on a schedule, into a real database,
and check that a known match still reads correctly — that is the only thing that turns it
into a fact.

### Recovery

1. Provision a new instance from the most recent snapshot or a PITR target.
2. Point `DATABASE_URL` at it.
3. `npm run db:deploy -w @badminton/api` to apply any migrations newer than the snapshot.
4. `npm run recompute -w @badminton/api -- --check` to confirm derived data is consistent
   with the restored games.
5. Verify `/health/ready` and sign in.

Step 4 exists because raw match data is the source of truth: after any restore, the
derived columns can be verified against it, and rebuilt if they disagree.
