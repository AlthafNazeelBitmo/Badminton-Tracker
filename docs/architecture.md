# Architecture

## The shape of it

```
          ┌───────────────────────────┐   ┌────────────────────────────────┐
 browser ►│  apps/web — Next.js 15    │   │  apps/mobile — Expo 57         │◄ phone
          │  React 19 · Tailwind · SWR│   │  React Native · SQLite         │
          └─────────────┬─────────────┘   │  ┌──────────────────────────┐  │
                        │                 │  │ local cache   (readable  │  │
       HTTPS, httpOnly cookies            │  │               offline)   │  │
                        │                 │  │ outbox        (writable  │  │
                        │                 │  │               offline)   │  │
                        │                 │  └──────────────────────────┘  │
                        │                 └─────────────┬──────────────────┘
                        │                               │ HTTPS, bearer token
                        │                               │ + Idempotency-Key
          ┌─────────────▼───────────────────────────────▼──────────────────┐
          │  apps/api — NestJS 11 · /api/v1 · zod validation                │
          │  ┌──────────────────────────────────────────────────────────┐  │
          │  │ Controller  → Service  → Prisma                          │  │
          │  │ HTTP only     rules      data access                     │  │
          │  └──────────────────────────────────────────────────────────┘  │
          └─────────────────────────────┬──────────────────────────────────┘
                                        │
                        ┌───────────────▼────────────────┐
                        │  PostgreSQL 16                 │
                        │  raw matches = source of truth │
                        └────────────────────────────────┘

  packages/contracts   zod schemas · enums · scoring rules   (api + web + mobile)
  packages/analytics   pure formulas, no framework            (api + mobile)
```

The web app never computes a statistic; it renders what the API returns.

The mobile app is the deliberate exception, and the reason is not performance. It has to
work in a sports hall with no signal, and it has to include the match recorded thirty
seconds ago that the server has not seen yet — a fetched figure would be unavailable in
the first case and wrong in the second. So it runs `aggregate()` locally over its own
cache.

That is only safe because the analytics package is framework-free and does no I/O: the
same function runs in Node on the server and in Hermes on the phone, over the same raw
matches, and gives the same answer. Had the formulas lived inside the API's service
layer, the mobile app would have had to reimplement them — and two implementations of
"win rate" drift apart the first time one of them is corrected.

---

## Why the shared packages exist

### `packages/contracts`

Zod schemas, domain enums and the scoring rules, imported by **all three** applications.

A validation rule written once is enforced everywhere. The web form rejects 21-20 before
the request is sent, the mobile app rejects it before the match is even queued, and the
API rejects it again on arrival. Those three checks cannot disagree, because they are the
same object.

The mobile case is the one that matters most: a queued match rejected by the server
surfaces minutes later, when the user is no longer at the court and cannot remember what
the real score was. Validating on the device turns that into an immediate correction.

It also holds the response types, so a change to an API payload is a compile error in the
web app rather than a runtime surprise.

### `packages/analytics`

Every formula, as pure functions over plain data — no Nest, no Prisma, no I/O.

That constraint buys three things: the analytics are unit-testable in milliseconds
without a database; they can be recomputed from raw data whenever a formula changes; and
there is exactly one implementation of "win rate" in the system.

The API layer's only job around analytics is to load the right matches, call the engine,
and attach display names. The mobile app does the same thing against its local cache.

---

## Request flow

Recording a match, end to end:

1. **Controller** — `ZodValidationPipe` parses the body against `createMatchSchema`.
   Invalid input never reaches a service. The parsed value carries coerced types (real
   `Date`s, numbers from query strings).
2. **Guards** — `RateLimitGuard` first, so an unauthenticated flood is rejected before it
   costs a database round trip; then `AuthGuard`, which verifies the token _and_
   re-checks the account against the database.
3. **Service** — validates the scoreline against the match's scoring format, then opens
   one transaction: resolve or create the session, resolve or create the players, write
   participants, games, tags and the derived columns.
4. **Projections** — ratings and achievements are refreshed _after_ the commit, so a
   failure there can never roll back a recorded result. Both are rebuildable.
5. **Response** — the match with its derived statistics and per-match insights.

---

## Design decisions

### Ownership never comes from the request

Every service takes `userId` from the authenticated session, injected by the
`@CurrentUser()` decorator. No endpoint accepts a user id as a parameter.

This makes horizontal privilege escalation structurally impossible rather than a rule
someone has to remember. There is no `?userId=` to tamper with, because ownership is
never read from client input. Integration tests assert the isolation directly.

### Secure by default

`AuthGuard` is registered globally; a route is public only if it carries `@Public()`.
Forgetting a decorator on a new controller leaves it _protected_, not open — the failure
mode points the safe way.

### The user's side is always HOME

`MatchParticipant.side` is `HOME` for the user's side and `AWAY` for the opposition,
always. Every analytics query is then symmetrical: an opponent is a participant on `AWAY`,
a partner is on `HOME` and not the user. One table answers both questions with no special
cases.

### People are modelled once

A `Player` is a person in a user's address book. Whether they were an opponent or a
partner is a property of the _match_, not of the person. Play against John this week and
with him next week and it is one row — which is what makes "your record against John" and
"your record with John" both answerable.

Quick entry creates players from typed names, which inevitably produces duplicates, so
merging is a first-class feature rather than a support request.

### Configurable scoring

Every match stores the format it was played under — `pointsToWin`, `winBy`, `maxPoints`,
`bestOf`. Changing your default never rewrites history, and a one-off 15-point social game
is validated against its own rules.

### Multi-tenant by construction

Every user-owned row carries `userId` with an index. The product is single-user in
practice and multi-user in structure: growing from one user to many needs no schema
rewrite, only the features on top.

---

## Web app

Next.js App Router. Pages are client components because this is an authenticated,
data-dense application where the server has nothing to prerender — a dashboard behind a
login has no useful static form.

- **Data fetching** — SWR against a typed client. Analytics keys do not revalidate on
  focus (the numbers do not change while you look at them); list keys keep previous data
  during pagination to avoid layout jumps.
- **Cache invalidation** — `invalidateMatchData()` names every key a new match affects, in
  one place. A new page cannot forget to refresh.
- **Auth** — httpOnly cookies. The client never reads or stores a token, so an XSS bug
  cannot exfiltrate a session. A 401 triggers one transparent refresh and retry;
  concurrent refreshes are collapsed into one request, because refresh tokens rotate and
  parallel attempts would trip the reuse detection.
- **Theme** — light and dark are each _selected_ palettes with tokens in CSS custom
  properties, not one derived from the other. Chart colours are the same tokens as the
  interface, so they cannot drift apart.

---

## Extension points

The features deliberately deferred all have somewhere to go:

| Future feature                   | What already supports it                                                          |
| -------------------------------- | --------------------------------------------------------------------------------- |
| Friends, sharing, leaderboards   | `Player.linkedUserId`, `Visibility` enum, per-user ownership                      |
| Clubs and tournaments            | `Session.sessionType` already includes `TOURNAMENT`                               |
| Coaching, training plans, drills | Sessions and matches are separate entities; a training session already has a type |
| Video and AI analysis            | Match data is fully structured; `notes` and tags carry the qualitative side       |
| Multiple API instances           | Rate limiting is behind a guard with a swappable store                            |
| Precomputed aggregates           | Analytics all funnel through one loader, so caching has one place to live         |

None of these are stubbed. They are simply not blocked.

---

## Where the layers stop

| Layer                | Does                           | Never does                      |
| -------------------- | ------------------------------ | ------------------------------- |
| Controller           | HTTP, validation, status codes | Business rules, database access |
| Service              | Business rules, transactions   | HTTP concerns, formulas         |
| `packages/analytics` | Formulas                       | I/O, framework, database        |
| `packages/contracts` | Shape and validity of data     | Behaviour                       |
| Web                  | Presentation, interaction      | Computing statistics            |

The one that matters most is the last row. Every time a client recomputes a number "just
for display", it becomes a second implementation that will eventually disagree with the
first.
