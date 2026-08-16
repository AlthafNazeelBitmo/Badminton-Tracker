# Security

What is protected, how, and — the part most documents skip — what is **not** yet
addressed.

---

## What we are protecting

Badminton results are not payment data, but they are personal: who you spend your
evenings with, where, how often, and a private journal of how you felt about it. The
threat model that follows takes that seriously without pretending this is a bank.

| Threat                        | Control                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| Reading another user's data   | Ownership from the session only; never a request parameter    |
| Credential stuffing           | Per-route rate limits, scrypt hashing, no account enumeration |
| Session theft via XSS         | httpOnly cookies; the client never touches a token            |
| Session theft via CSRF        | `SameSite=Lax`, strict CORS origin allow-list                 |
| Stolen refresh token          | Rotation with family-wide revocation on reuse                 |
| Database leak                 | Passwords and all tokens stored only as hashes                |
| Impossible or malicious input | zod at the boundary, domain validation in services            |
| Information leakage in errors | Single exception filter; internals never returned             |

---

## Authentication

**Password storage.** scrypt (RFC 7914) at N=2^16, r=8, p=1 — current OWASP parameters,
about 100 ms per hash. Chosen over argon2 and bcrypt deliberately: both need native
compilation, which is a recurring source of broken container builds and extra supply-chain
surface, and the difference at these parameters is not the weak link in this system. The
stored format is self-describing (`scrypt$N$r$p$salt$hash`), so the cost can be raised
later and existing hashes both still verify and are upgraded transparently on the user's
next login.

**Passwords are length-first**: at least 12 characters with a letter and a number,
following current NIST guidance. A long passphrase beats mandatory symbol soup.

**Access tokens** are short-lived JWTs (15 minutes) carrying a `typ` claim, so an access
token cannot be replayed as a refresh token. The guard verifies the signature _and_
re-reads the account, because a token is a claim about identity, not proof that the
account still exists or is still permitted.

**Refresh tokens** are opaque random strings, not JWTs — a refresh token must be
revocable, and a self-contained token is not. Only a SHA-256 digest is stored. They rotate
on every use and are grouped into a family; presenting an already-rotated token means a
replay or a theft, and the entire family is revoked.

**Cookies**: `httpOnly` (unreachable from JavaScript), `sameSite=lax` (blocks cross-site
POSTs, the CSRF defence for a cookie-authenticated API), `secure` in production, and the
refresh cookie scoped to `/api/v1/auth` so it is not attached to ordinary API calls.

**No account enumeration.** Login returns an identical code, message and timing for an
unknown address and a wrong password — the timing equality comes from hashing anyway when
no user is found. Password reset always returns 202.

---

## Authorisation

Ownership comes from the authenticated session via `@CurrentUser()`. No endpoint accepts
a user id.

`AuthGuard` is registered globally; a route is public only with `@Public()`. Forgetting a
decorator leaves a new endpoint protected rather than open.

Another user's resource returns **404, not 403**. A 403 confirms the id exists.

Admin routes carry `@Roles('ADMIN')` at the class level and are deliberately limited to
account state, aggregate counts and the audit log. **An admin cannot read another user's
matches** — "administrator" should not mean "can read everyone's private statistics".

Integration tests assert isolation directly: a second account cannot list, fetch, delete,
export or reference the first account's data.

---

## Input validation

Two layers, both required:

1. **Boundary** — zod parses every body and query string. Invalid input never reaches a
   service. The same schemas run in the browser, so the two cannot disagree.
2. **Domain** — badminton rules in services: legal scorelines for the format, participant
   counts matching the discipline, nobody on both sides.

SQL injection is structurally excluded — Prisma parameterises everything, and the two raw
queries (`SELECT 1`, and a truncate guarded to `NODE_ENV=test`) take no user input.

XSS: React escapes by default and the codebase contains no `dangerouslySetInnerHTML`.

**CSV injection** is handled on export: a field starting `=`, `+`, `-` or `@` is prefixed
with a quote so a spreadsheet does not execute an exported "name" of `=1+1`. Plain
numbers, including negatives, are exempt — quoting `-7` would corrupt every point
differential in the file.

---

## Transport and headers

Helmet sets a restrictive CSP, `nosniff`, `frame-ancestors: none`, a strict referrer
policy and — in production — HSTS with a one-year max-age.

CORS names a single origin from `WEB_PUBLIC_URL` with credentials enabled. A wildcard is
impossible with credentialed requests, and an origin reflector would be an open door.

`trust proxy` is set to `1`, not `true`. Trusting every hop lets any caller spoof
`X-Forwarded-For` and defeat IP-based rate limiting.

---

## Configuration

Validated at boot; the process refuses to start on a bad config rather than failing later
under load. Production adds stricter checks that cannot be satisfied by accident:

- Access and refresh secrets must differ.
- Secrets must be ≥32 characters and must not contain placeholder markers
  (`replace-me`, `changeme`, `secret`, …).
- `COOKIE_SECURE` must be true.
- `WEB_PUBLIC_URL` must be HTTPS.
- Rate limiting cannot be disabled.

That last one is why the test-only `RATE_LIMIT_ENABLED=false` switch is safe: production
configuration rejects it outright.

Secrets come from the platform's secret store. `.env` is gitignored; `.env.example`
contains only placeholders.

---

## Logging and audit

Structured JSON in production. Logs carry a request id, method, route _pattern_ (not the
populated path, so ids stay out of logs), status and duration.

Never logged: passwords, tokens, session cookies, or raw IP addresses. The audit log and
rate limiter both store a SHA-256 digest of the IP — enough to correlate one actor's
requests, not a fresh pile of personal data.

The audit log records registration, login, failed login, logout, password change and
reset, email verification, imports, exports and admin actions. Writing an audit entry
never breaks the operation it describes: failures are logged and swallowed.

---

## Privacy

Performance data is private by default. There is no public profile and no sharing
surface. `Visibility` exists in the schema for future opt-in sharing and is `PRIVATE`
everywhere today.

`GET /users/me/export` returns everything held about an account, excluding credentials and
tokens. Deleting a user cascades to all their data.

---

## Pre-deployment checklist

- [ ] Secrets generated randomly, ≥32 characters, different from each other
- [ ] Secrets in the platform's secret store, not in an image or compose file
- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, `WEB_PUBLIC_URL` on HTTPS
- [ ] `ENABLE_SWAGGER=false` unless the docs are meant to be public
- [ ] `ALLOW_REGISTRATION=false` for a single-user deployment
- [ ] Database not publicly reachable; TLS enforced (`?sslmode=require`)
- [ ] Automated backups on, with a restore rehearsed
- [ ] HTTPS terminated at the edge, HTTP redirected
- [ ] `npm audit --omit=dev` clean
- [ ] Error monitoring receiving events
- [ ] Rate limits reviewed for expected traffic
- [ ] `/health/ready` wired to the platform's health checks

---

## Known gaps

Stated plainly, because an undocumented gap is worse than a documented one.

| Gap                                                          | Impact                                                                                                                                   | Mitigation / plan                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **No email delivery**                                        | Password reset and email verification generate and validate tokens correctly, but nothing sends them. In development the link is logged. | A locked-out user currently needs an operator. Wire a transport before opening to users who cannot be helped directly. |
| **Rate limiting is per-instance**                            | Behind two API instances the effective budget doubles.                                                                                   | Correct for the recommended single-instance deployment. Swap the guard's store for Redis when scaling out.             |
| **No 2FA**                                                   | An account is one password away.                                                                                                         | Deferred; the token infrastructure would support TOTP.                                                                 |
| **No account lockout**                                       | Rate limiting slows brute force but never locks an account.                                                                              | Deliberate: lockout is a denial-of-service vector against a known address. Revisit with 2FA.                           |
| **No CSP on the API's own responses beyond helmet defaults** | The API returns JSON; the only HTML is Swagger UI, which needs inline styles.                                                            | Disable Swagger in production and the surface disappears.                                                              |
| **Audit log has no retention policy**                        | Grows without bound.                                                                                                                     | Add a scheduled purge before long-running production use.                                                              |
| **No automated dependency scanning in CI**                   | A new CVE is not surfaced automatically.                                                                                                 | Add `npm audit` or Dependabot to the pipeline.                                                                         |

## Reporting a vulnerability

Do not open a public issue. Contact the maintainer directly with the request id from any
relevant error response and steps to reproduce.
