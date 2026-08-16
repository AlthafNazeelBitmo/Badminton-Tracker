# Roadmap

An honest account of what is built, what is not, and why.

---

## Built and verified

Everything here runs against a real database and is covered by tests.

**Foundation**

- Monorepo with shared contracts and a framework-free analytics engine
- Normalised PostgreSQL schema, migrations, realistic seed data
- Configuration validated at boot, stricter in production
- Structured logging, request ids, health probes, single exception filter

**Authentication and security**

- scrypt hashing with transparent upgrade, httpOnly cookies, rotating refresh tokens
  with family revocation, password reset and email verification token flows
- Ownership from the session only; secure-by-default guards; audit logging
- Per-route rate limiting, helmet, strict CORS

**Recording**

- Quick match entry in a single request, with resolve-or-create for players and venues
- Singles, doubles, mixed; configurable scoring formats
- Badminton-aware validation on both client and server, from one schema
- Sessions, venues, players with merge; match edit and delete with renumbering

**Analytics**

- One aggregation function behind every breakdown
- Trends with time-zone-aware bucketing; opponents, partners, venues, disciplines
- Situational analysis, documented consistency score, fatigue view
- Elo rating replayed from raw matches; personal records; activity heatmap
- Insights separating observation, interpretation and recommendation, each with evidence

**Progress**

- Goals computed per request; automatic achievement detection; deduplicated notifications

**Data portability**

- CSV import with row-by-row preview; CSV/JSON export; full account export
- Performance report composed from the analytics endpoints

**Interface**

- Mobile-first, bottom navigation, Record raised in the middle
- Light and dark as separately selected palettes
- Charts with validated colours, one axis, and the numbers always available as text
- Keyboard navigation, skip links, semantic tables, focus rings

**Operations**

- Multi-stage Dockerfiles running unprivileged; docker compose for development
- CI: format, lint, types, unit, integration, browser, image builds, schema drift
- `recompute` command as the invalidation mechanism for derived data

---

## Not built

Stated plainly rather than stubbed. Each has somewhere to go.

### Email delivery — the one real gap

Password reset and email verification generate tokens, store only their hashes, expire
them, and consume them atomically. **Nothing sends them.** In development the link is
logged to the console.

Consequence: a user who forgets their password needs an operator to read the token from
the logs. For a single-user deployment that is the same person. Before opening the app to
users you cannot help directly, wire a transport — the token infrastructure is finished
and only needs a send call.

### Avatar uploads

`avatarUrl` exists on `User` and `Player`; there is no upload endpoint. Adding one means
object storage, a signed-URL flow, and content-type and size validation. Names and
initials are shown meanwhile.

### Social features

Friends, following, leaderboards, clubs, tournaments, public profiles, match sharing.

Not blocked: `Player.linkedUserId` connects a contact to a real account, the `Visibility`
enum exists on profiles, and every row is already owned by a user. The schema does not
need to change; the features simply are not written.

### Coaching

Training plans, drills, skill ratings, coach feedback. `SessionType` already includes
`TRAINING` and `COACHING`, and a coach can already be a `Player` with the `COACH`
relationship.

### Video and AI analysis

The data is structured for it — every match, game, participant and tag is queryable, with
`notes` carrying the qualitative side. An AI feature would read the same analytics
endpoints the interface does, so its claims would be as checkable as the dashboard's.

### Internationalisation

Dates, numbers and relative times already use `Intl` with the browser's locale, and no
date format is hardcoded. Interface **strings** are English and not extracted into a
message catalogue. Adding one is mechanical; doing it before there is a second language
is speculative.

### Offline support

The web app is installable (manifest, standalone display, a Record shortcut) but has no
service worker, so it needs a connection. Sports halls have poor signal, and queueing a
match entry offline is the obvious next improvement to the core flow.

---

## If you continue

In the order that would deliver most:

1. **Email transport.** It is the only gap that leaves a user genuinely stuck.
2. **Offline entry.** Directly serves the product's central promise.
3. **Match editing in the interface.** The API supports it; the web app currently offers
   delete-and-re-record.
4. **Audit log retention.** A scheduled purge before long production use.
5. **Dependency scanning in CI.** `npm audit` or Dependabot.
6. **Then measure before optimising.** Caching, replicas and precomputed aggregates are
   all straightforward when a number says they are needed, and premature otherwise.
