# Deployment

## Recommended architecture

```
                    ┌─────────────────────────┐
   users ─────────► │  CDN / edge (HTTPS)     │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
   ┌──────────▼──────────┐          ┌─────────────▼─────────────┐
   │  web (Next.js)      │  ──────► │  api (NestJS)             │
   │  app.example.com    │          │  api.example.com          │
   └─────────────────────┘          └─────────────┬─────────────┘
                                                  │ TLS
                                    ┌─────────────▼─────────────┐
                                    │  Managed PostgreSQL 16    │
                                    │  automated backups + PITR │
                                    └───────────────────────────┘
```

**Two containers and a managed database.** For a personal tracker — and for a long way
beyond it — that is the right amount of infrastructure. Kubernetes, message queues, a
cache tier and a service mesh would each add an operational failure mode to solve a
problem this workload does not have.

### Why these choices

**Managed PostgreSQL, not a container.** Backups, point-in-time recovery, patching and
failover are exactly the things you do not want to be responsible for at 2am, and exactly
the things a managed service does well. The compose file runs PostgreSQL in a container
for development only.

**Same parent domain for web and API.** `app.example.com` and `api.example.com` are
same-site, so the `SameSite=Lax` session cookies work without loosening anything. Putting
them on unrelated domains forces `SameSite=None`, which throws away the CSRF protection.

**Single API instance to start.** The rate limiter is in-process, which is correct and
simple for one instance. Scale vertically first; when you genuinely need a second
instance, move the limiter's store to Redis — the guard interface does not change.

**No cache tier initially.** The analytics engine recomputes from raw matches on every
request. At a few thousand matches that is milliseconds. Add caching when a measurement
says to, not before.

**Background jobs run inside the API.** Reminders every 15 minutes and idempotency-key
cleanup hourly, on timers in the API process — no separate worker to deploy. That assumes
the process stays up. On a platform that scales to zero (Fly.io with auto-stop, Cloud Run
with minimum instances at zero), set `BACKGROUND_JOBS_ENABLED=false` and point the
platform's scheduler at the same image instead:

```bash
node dist/cli/jobs.js            # every 15 minutes
```

Both paths are safe to run concurrently and on several instances: each job claims its
work with a conditional update, so nothing is sent twice.

### Platform options

| Platform                      | Fit                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Railway / Render / Fly.io** | Best fit. Both Dockerfiles deploy directly, managed PostgreSQL included, sensible pricing at this size.         |
| **Vercel + Neon**             | Supported and live. Both apps deploy to Vercel, the API as a function. See [Vercel and Neon](#vercel-and-neon). |
| **AWS / GCP / Azure**         | Fine, and considerable overkill here. ECS/Fargate or Cloud Run with RDS/Cloud SQL if you are already invested.  |
| **A single VPS**              | Entirely workable with docker compose, provided you take on backups yourself and actually test the restore.     |

---

## Vercel and Neon

The hosted deployment. Both apps are Vercel projects built from this repository; the
database is Neon, provisioned through Vercel's Neon integration.

| Piece    | Vercel project          | Root directory | URL                                      |
| -------- | ----------------------- | -------------- | ---------------------------------------- |
| Web app  | `badminton-tracker-web` | `apps/web`     | https://badminton-tracker-web.vercel.app |
| API      | `badminton-tracker-api` | `apps/api`     | https://badminton-tracker-api.vercel.app |
| Database | Neon (free plan)        | —              | us-east-1, alongside Vercel's `iad1`     |

### How the pieces fit

- **The API runs as one serverless function.** `apps/api/api/index.js` re-exports the
  handler in `src/serverless.ts`, which builds the Nest application once per instance and
  reuses it. `apps/api/vercel.json` routes every path to it.
- **The browser talks only to the web app.** `apps/web/src/middleware.ts` forwards `/api/*`
  and `/health/*` to `API_ORIGIN`, so session cookies are first-party and no CORS
  preflight happens. The middleware passes on the visitor's address with
  `TRUSTED_PROXY_SECRET`, which both projects hold; without it, every visitor would share
  the proxy's few addresses and its sign-in rate limits.
- **The phone talks to the API directly**, at the address compiled into preview and
  production builds (`apps/mobile/app.config.ts`).
- **Rate limits live in Postgres** (`RATE_LIMIT_STORE=database`). A memory count would
  reset with every cold start and differ between instances.
- **Jobs run from Vercel Cron**, not timers (`BACKGROUND_JOBS_ENABLED=false`). The cron
  calls `GET /api/v1/internal/cron` with `Authorization: Bearer $CRON_SECRET`, which
  Vercel adds itself.
- **Migrations run in the API build** (`apps/api/scripts/vercel-build.sh`), over Neon's
  direct connection (`DATABASE_URL_UNPOOLED`). The application uses the pooled one.

### The Hobby plan's limits

Vercel's free plan runs a cron job **at most once a day**, at a time within the scheduled
hour. The job is scheduled for 12:00 UTC, which falls inside the 09:00–21:00 reminder
window for most of Europe, Africa and Asia and for the Americas' east coast. A reminder
waiting outside someone's window is sent on a later day's run, within the 48-hour limit.

For reminders every 15 minutes, either move to the Pro plan and change the schedule in
`apps/api/vercel.json` to `*/15 * * * *`, or call the cron URL from any external scheduler
with the same bearer secret.

### Configuration

Set on the Production environment of each project. Secrets are `sensitive` variables:
Vercel will not show them again, and they are never in the repository.

| Project | Variable                                                                             |
| ------- | ------------------------------------------------------------------------------------ |
| API     | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` — from the Neon integration                  |
| API     | `NODE_ENV=production`, `COOKIE_SECURE=true`, `LOG_JSON=true`, `ENABLE_SWAGGER=false` |
| API     | `API_PUBLIC_URL`, `WEB_PUBLIC_URL` — the two URLs above                              |
| API     | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET` — random, distinct          |
| API     | `RATE_LIMIT_STORE=database`, `BACKGROUND_JOBS_ENABLED=false`                         |
| Both    | `TRUSTED_PROXY_SECRET` — the same random value in both                               |
| Web     | `API_ORIGIN=https://badminton-tracker-api.vercel.app`, `NEXT_PUBLIC_API_URL=/`       |

`NEXT_PUBLIC_API_URL=/` makes the web client call its own origin, where the middleware
picks the request up.

### Deploying

From the repository root, with the Vercel CLI signed in:

```bash
VERCEL_ORG_ID=<team id> VERCEL_PROJECT_ID=<api project id> vercel deploy --prod
VERCEL_ORG_ID=<team id> VERCEL_PROJECT_ID=<web project id> vercel deploy --prod
```

The ids are in each project's settings. Deploy from the root, not from `apps/*`: the
projects build from the whole workspace. `.vercelignore` keeps `.env`, dependencies and
the mobile app out of the upload. Connecting the GitHub repository in each project's
settings makes every push to `main` deploy automatically instead.

Deploy the API first when a change touches both: its build applies migrations, and a
web app expecting a newer API should not go out ahead of it.

---

## Environments

| Environment | Database                   | Registration   | Swagger | Notes                                            |
| ----------- | -------------------------- | -------------- | ------- | ------------------------------------------------ |
| Development | Local container            | Open           | On      | `npm run dev`                                    |
| Test        | Ephemeral, truncated       | Open           | Off     | CI only; `TEST_DATABASE_URL` must contain "test" |
| Staging     | Managed, separate instance | Open           | On      | Mirrors production configuration                 |
| Production  | Managed + PITR             | Usually closed | Off     | Strict config validation applies                 |

---

## Configuration

Every variable is documented in [`.env.example`](../.env.example). The API validates its
whole configuration at boot and refuses to start on a bad one — a server that boots
broken and fails later, under load, is strictly worse than one that never starts.

Production requires, and enforces:

```bash
NODE_ENV=production
DATABASE_URL=postgresql://…?sslmode=require
JWT_ACCESS_SECRET=<48 random bytes, base64url>
JWT_REFRESH_SECRET=<a different 48 random bytes>
WEB_PUBLIC_URL=https://app.example.com     # must be HTTPS
COOKIE_SECURE=true                          # must be true
COOKIE_DOMAIN=.example.com                  # if sharing a parent domain
ENABLE_SWAGGER=false
ALLOW_REGISTRATION=false                    # single-user deployment
LOG_JSON=true
```

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`NEXT_PUBLIC_API_URL` is baked into the client bundle at **build** time, so it must be
supplied as a Docker build argument, not a runtime variable.

---

## Deploying

### Containers

```bash
docker build -f apps/api/Dockerfile -t badminton-api:latest .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  -t badminton-web:latest .
```

Both images are multi-stage: no compilers, no source and no dev dependencies in the
runtime layer, running as an unprivileged user, with `dumb-init` as PID 1 so SIGTERM
reaches Node and the graceful shutdown hooks actually run.

### Order of operations

1. Apply migrations **before** the new code starts:
   ```bash
   npm run db:deploy -w @badminton/api
   ```
   Or run it as a release command / init container.
2. Deploy the API. Wait for `/health/ready`.
3. Deploy the web app.

For a schema change that would break the running version, use expand-migrate-contract
across three releases — see [database.md](database.md).

### Health checks

| Path            | Purpose                             | Checks the database |
| --------------- | ----------------------------------- | ------------------- |
| `/health/live`  | Liveness — is the process up        | No                  |
| `/health/ready` | Readiness — can this instance serve | Yes                 |

Point the orchestrator's **liveness** probe at `/live` and its **readiness** probe at
`/ready`. Pointing liveness at a database-checking endpoint means a database blip
restarts perfectly healthy application containers, turning a brief outage into a longer
one.

Both are version-neutral and outside the `/api` prefix, so a version bump never silently
breaks monitoring.

---

## Observability

Structured JSON logs to stdout when `LOG_JSON=true` — the portable interface every log
aggregator understands. No provider SDK is hardwired; shipping logs is the platform's job.

Each request produces one line with a request id, method, route pattern, status and
duration. Requests slower than `SLOW_REQUEST_MS` are raised to `warn`, so a latency
regression is visible without a dashboard.

`SENTRY_DSN` is read from configuration and left unset by default.

Worth alerting on: error rate above baseline, p95 latency, `/health/ready` failures,
database connection saturation, and a spike in `auth.login_failed` audit entries.

---

## Backups

Covered in detail in [database.md](database.md). The short version: daily automated
backups retained 30 days, PITR with a 7-day window, a manual snapshot before any
destructive migration, and a **restore rehearsed quarterly**.

An untested backup is a hypothesis, not a backup.

---

## Scaling, when it is actually needed

In the order the pressure will appear:

1. **Vertical first.** More CPU and memory on one instance is simpler than a second
   instance and solves most of this.
2. **Database indexes.** The existing ones cover current queries; check `EXPLAIN ANALYZE`
   before adding more.
3. **Cache expensive analytics.** All analytics funnel through one loader, so caching has
   exactly one place to live.
4. **Second API instance.** Move the rate limiter's store to Redis at the same time.
   Background jobs need no change — they already claim work atomically. Reminder
   generation does load each push-enabled user's matches every 15 minutes; past a few
   thousand such users, generate only for those with new activity or a due date.
5. **Read replica.** Analytics are read-only and would move cleanly.
6. **Precomputed aggregates.** Materialised views for the heaviest breakdowns — with
   `recompute` already in place as the invalidation story.

Do these when a measurement says to. Every one of them adds an operational failure mode.

---

## Rollback

The application is stateless, so rolling back is redeploying the previous image.

Schema changes are the exception. A migration that dropped a column cannot be undone by
redeploying old code — which is exactly why destructive changes go through
expand-migrate-contract, so there is always a release boundary where the old and new code
both work against the same schema.

After any restore or rollback that touched the database:

```bash
npm run recompute -w @badminton/api -- --check
```

Raw match data is the source of truth, so derived values can always be verified against
it — and rebuilt if they disagree.
