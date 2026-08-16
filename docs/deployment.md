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

### Platform options

| Platform                       | Fit                                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Railway / Render / Fly.io**  | Best fit. Both Dockerfiles deploy directly, managed PostgreSQL included, sensible pricing at this size.        |
| **Vercel (web) + managed API** | Excellent for the Next.js app; the API needs to live elsewhere as a container.                                 |
| **AWS / GCP / Azure**          | Fine, and considerable overkill here. ECS/Fargate or Cloud Run with RDS/Cloud SQL if you are already invested. |
| **A single VPS**               | Entirely workable with docker compose, provided you take on backups yourself and actually test the restore.    |

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
