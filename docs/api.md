# API

Base URL `/api/v1`. Interactive documentation at `/api/docs` when `ENABLE_SWAGGER=true`.

---

## Conventions

**Authentication.** Every endpoint requires it unless marked public. The web client uses
httpOnly cookies; scripts and other clients may send `Authorization: Bearer <token>`.

**Ownership.** Taken from the session, never from a request parameter. There is no
`?userId=`. A resource belonging to another user returns **404, not 403** — a 403 would
confirm that the id exists.

**Validation.** Request bodies and query strings are parsed with the zod schemas in
`@badminton/contracts` — the same objects the web client validates against. A failure
returns 422 with per-field details.

**Rates.** Any rate can be `null`, meaning unknown (zero denominator). Clients must render
that as unknown, never as zero.

---

## Errors

Every error has the same shape:

```json
{
  "statusCode": 422,
  "code": "VALIDATION_FAILED",
  "message": "The scores are not valid for this format.",
  "details": [
    {
      "path": "games.0",
      "message": "21-20 is not reachable under best of 3 to 21 (win by 2, cap 30).",
      "code": "GAME_IMPOSSIBLE_SCORE"
    }
  ],
  "requestId": "9f3c1e5a-...",
  "timestamp": "2026-08-16T15:20:55.591Z"
}
```

`code` is stable and machine-readable — branch on it rather than on `message`.
`requestId` is echoed in the `x-request-id` header and appears in the server logs, so a
user can quote it and the exact request can be found.

Stack traces, SQL and Prisma internals are never returned. Unexpected errors are logged
in full server-side and reduced to a generic message.

| Status | Code                                   | Meaning                            |
| ------ | -------------------------------------- | ---------------------------------- |
| 401    | `UNAUTHORIZED` / `INVALID_CREDENTIALS` | Not signed in, or bad credentials  |
| 403    | `FORBIDDEN`                            | Signed in, insufficient role       |
| 404    | `NOT_FOUND`                            | Absent, or not yours               |
| 409    | `CONFLICT` / `DUPLICATE`               | Would violate a uniqueness rule    |
| 422    | `VALIDATION_FAILED`                    | Malformed or impossible input      |
| 429    | `RATE_LIMITED`                         | Budget exceeded; see `Retry-After` |

---

## Authentication

| Method | Path                           | Public | Notes                                            |
| ------ | ------------------------------ | ------ | ------------------------------------------------ |
| POST   | `/auth/register`               | ✓      | Creates account, profile and self-player. 5/hour |
| POST   | `/auth/login`                  | ✓      | 10 per 5 minutes                                 |
| POST   | `/auth/refresh`                | ✓      | Rotates the refresh token                        |
| POST   | `/auth/logout`                 |        | Revokes the presented token                      |
| GET    | `/auth/me`                     |        | Current user                                     |
| POST   | `/auth/change-password`        |        | Revokes every session                            |
| POST   | `/auth/request-password-reset` | ✓      | Always 202, whether or not the address exists    |
| POST   | `/auth/reset-password`         | ✓      |                                                  |
| POST   | `/auth/verify-email`           | ✓      |                                                  |

Login returns the same code and message for an unknown email and a wrong password, and
takes the same time, so the endpoint cannot be used to enumerate accounts.

---

## Matches

### `POST /matches` — record a match

The endpoint the product is built around. Accepts either an existing `sessionId` or an
inline `session`; opponents and partners by `playerId` or by `name`, with unknown names
created automatically. That is what makes quick entry a single request.

```json
{
  "discipline": "DOUBLES",
  "session": { "date": "2026-08-15", "venueName": "Riverside", "sessionType": "CASUAL" },
  "partners": [{ "name": "Ahmed Rahim" }],
  "opponents": [{ "name": "John Carter" }, { "playerId": "…" }],
  "games": [
    { "myScore": 21, "opponentScore": 18 },
    { "myScore": 17, "opponentScore": 21 },
    { "myScore": 21, "opponentScore": 16 }
  ],
  "durationSeconds": 2520,
  "difficulty": 4,
  "tags": ["GREAT_TEAMWORK"],
  "notes": "Slow start, changed to flat drives"
}
```

Everything after `games` is optional. `scoring` may be supplied to override the user's
default format.

The response includes `derived` — result, games won, point differential, and the
comeback/collapse/clutch/blowout flags — all computed from the games. **A `result` sent by
a client is ignored**; the scoreline decides.

Rejected with 422: impossible scores (21-20, 23-19), games recorded after the match was
decided, participant counts that do not match the discipline, and the same person on both
sides.

| Method | Path           | Notes                                                                                                                                                                              |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/matches`     | Filter by date, discipline, result, session, venue, opponent, partner, tag, difficulty, free text. Sort by newest, oldest, biggest win, narrowest margin, longest, highest scoring |
| GET    | `/matches/:id` | Full detail with per-match insights and rating change                                                                                                                              |
| PATCH  | `/matches/:id` | Full replacement; derived columns and ratings are recomputed                                                                                                                       |
| DELETE | `/matches/:id` | Renumbers the session so positions stay contiguous                                                                                                                                 |

---

## Analytics

Every analytics endpoint takes the same filter, so one control bar drives all of them:

| Parameter                                                                                        | Values                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `preset`                                                                                         | `TODAY`, `THIS_WEEK`, `THIS_MONTH`, `LAST_30_DAYS`, `LAST_90_DAYS`, `LAST_180_DAYS`, `THIS_YEAR`, `LAST_YEAR`, `ALL_TIME`, `CUSTOM` |
| `from`, `to`                                                                                     | Required when `preset=CUSTOM`                                                                                                       |
| `discipline`, `sessionType`, `venueId`, `opponentId`, `partnerId`, `result`, `difficulty`, `tag` | Optional dimensions                                                                                                                 |
| `timeZone`                                                                                       | IANA zone. Determines what counts as a day, week or month                                                                           |

`timeZone` matters: "this month" means the user's month. An unrecognised zone is rejected
with 422 rather than silently bucketing into the wrong days.

| Path                                             | Returns                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `/analytics/overview`                            | Headline stats, streaks, counts, rating, and the previous period for comparison |
| `/analytics/trend?granularity=`                  | Performance by day, week, month or year                                         |
| `/analytics/form?window=`                        | Rolling win rate over recent matches                                            |
| `/analytics/opponents`                           | Head-to-head record per opponent                                                |
| `/analytics/partners`                            | Record per doubles partner                                                      |
| `/analytics/venues`                              | Per venue, split by singles and doubles                                         |
| `/analytics/disciplines`                         | Singles vs doubles vs mixed                                                     |
| `/analytics/situational`                         | Clutch, blowout, deciders, comebacks, consistency                               |
| `/analytics/fatigue`                             | Performance by position within a session                                        |
| `/analytics/tags`                                | Win rate associated with each tag                                               |
| `/analytics/difficulty`                          | Performance by self-reported difficulty                                         |
| `/analytics/heatmap`                             | Calendar activity                                                               |
| `/analytics/records`                             | Personal records                                                                |
| `/analytics/insights`                            | Generated insights with evidence                                                |
| `/analytics/rating`, `/analytics/rating/history` | Estimated rating and its progression                                            |
| `/analytics/search?q=`                           | Players, venues, sessions and matches                                           |

Definitions for every number are in [analytics.md](analytics.md).

---

## Other resources

| Path                           | Methods                                        | Notes                                                                                      |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/players`                     | GET, POST, PATCH, DELETE                       | Deleting a player who has played is refused                                                |
| `/players/:id/merge/:targetId` | POST                                           | Moves every appearance across, then removes the duplicate                                  |
| `/venues`                      | GET, POST, PATCH, DELETE                       | Deleting detaches sessions; matches are never lost                                         |
| `/sessions`                    | GET, POST, PATCH, DELETE                       | Delete reports how many matches went with it                                               |
| `/goals`                       | GET, POST, PATCH, DELETE                       | Progress computed per request, never stored                                                |
| `/achievements`                | GET, POST `/evaluate`                          | Detection is idempotent                                                                    |
| `/notifications`               | GET, POST `/refresh`, `/:id/read`, `/read-all` | Deduplicated by key                                                                        |
| `/users/me`                    | GET, PATCH                                     | Profile, preferences, default scoring format                                               |
| `/users/me/export`             | GET                                            | Everything held about the account                                                          |
| `/reports/performance`         | GET                                            | Full report; same filter as analytics                                                      |
| `/transfer/import/preview`     | POST                                           | Validates and reports; **writes nothing**                                                  |
| `/transfer/import/commit`      | POST                                           | Imports only the rows the user accepted                                                    |
| `/transfer/import/template`    | GET                                            | CSV template the importer accepts                                                          |
| `/transfer/export`             | GET                                            | `dataset` × `format` (csv, json)                                                           |
| `/admin/*`                     |                                                | `ADMIN` role. Account state, aggregate counts, audit log — never another user's match data |

---

## Pagination

List endpoints take `page` (from 1) and `pageSize` (max 100):

```json
{
  "items": [],
  "meta": {
    "page": 1,
    "pageSize": 25,
    "totalItems": 237,
    "totalPages": 10,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

---

## Rate limits

Per user when authenticated, per hashed IP otherwise. `X-RateLimit-Limit`,
`X-RateLimit-Remaining` and `X-RateLimit-Reset` are returned on every response; a 429 adds
`Retry-After`.

| Endpoint                            | Budget                                 |
| ----------------------------------- | -------------------------------------- |
| `POST /auth/register`               | 5 / hour                               |
| `POST /auth/login`                  | 10 / 5 minutes                         |
| `POST /auth/change-password`        | 5 / 15 minutes                         |
| `POST /auth/request-password-reset` | 5 / hour                               |
| `POST /transfer/import/*`           | 10–20 / 10 minutes                     |
| `GET /users/me/export`              | 3 / hour                               |
| Everything else                     | `RATE_LIMIT_MAX`, default 300 / minute |

The limiter is in-process, which is the right size for a single API instance. Behind more
than one it becomes per-instance; swap the store for Redis at that point. The guard
interface does not change.
