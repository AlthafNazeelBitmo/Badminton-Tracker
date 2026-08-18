# The mobile app

An Expo (React Native) app that records a match in about twenty seconds, at the side of a
court, with no signal.

That last clause is the whole design. Badminton is played indoors, often in halls where
mobile signal is poor or absent, and the moment somebody will actually record a match is
the minute after finishing one — not later that evening when the score is already fuzzy.
An app that needs a connection to save a match will simply not be used at the time it
matters, and a match entered from memory two days later is worth less than one entered
accurately on the spot.

Everything below follows from that.

## Running it

```bash
npm install
npm run build:packages          # the shared packages the app imports
npm run dev:api                 # the API, on :4000
npm run dev:mobile              # Metro, with a QR code
```

Install **Expo Go** and scan the code, or press `i` / `a` for a simulator.

One thing catches everyone once: `localhost` works in a simulator, which shares your
machine's network stack, but a physical phone is a different machine. Copy your LAN
address from the URL Metro prints and put it in `apps/mobile/.env.local`:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.23:4000/api/v1
```

Get this wrong and the symptom is the app behaving exactly as though the phone were
offline — which sends you debugging the sync layer instead of a URL.

Expo Go covers everything except push notifications and the biometric lock, which need
native modules it does not ship. For those, build a development client:

```bash
cd apps/mobile
npx eas build --profile development --platform ios     # or android
```

## How offline works

Three pieces, each doing one job.

### The local database

SQLite on the device, holding two things that are deliberately kept apart:

- **The cache** — `matches`, `sessions`, `players`, `venues`. A mirror of the server,
  written only by sync. It can be deleted and rebuilt at any time without losing anything.
- **The outbox** — writes the server has not accepted yet. The only table holding data
  that exists nowhere else, and so the only one whose loss would lose a match.

A match recorded offline lives in both: in the cache so it appears in the history
immediately, and in the outbox until the server confirms it. The `pending_local` flag on
the cached row is what shows the "queued" marker.

### The outbox

The rule that makes it safe: **an idempotency key is generated once, when the entry is
queued, and never regenerated** — not on automatic retry, not when a person retries a
failed entry by hand.

The dangerous case is not a failed request. It is a _successful_ request whose response
never arrived. The phone cannot tell those two apart, so it retries; without a stable key,
that retry creates a second match. With one, the server recognises the replay and returns
the original result.

Failures split into two kinds, and conflating them is how offline apps either lose data or
hammer a server pointlessly:

| Kind      | Example                    | What happens                                                   |
| --------- | -------------------------- | -------------------------------------------------------------- |
| Retryable | No signal, 500, 429        | Exponential backoff to a five-minute ceiling. Retried forever. |
| Permanent | 422 on an impossible score | Parked immediately and surfaced. Never silently discarded.     |

A network failure stops the drain at that entry rather than working through the queue:
the entries behind it are causally ordered, and the network has just demonstrated it is
not there.

After twelve attempts an entry is parked rather than deleted. It is somebody's match, and
they get to decide what happens to it — settings offers _Retry_ (with the original key, so
it cannot duplicate) and _Discard_.

### Sync

Push first, then pull. The order is not arbitrary: pulling first would overwrite the
cached copy of a match that has not reached the server yet, and it would vanish from the
history while still sitting in the queue.

Pulling uses two parameters with distinct jobs:

- **`since`** starts a run — the `syncedAt` from the last _completed_ run. Server time,
  never the device clock, because a phone with a wrong clock would ask for changes since a
  moment that has not happened and silently skip records.
- **`cursor`** continues a run, and is opaque to the client.

A timestamp alone cannot page. A CSV import writes hundreds of rows carrying an identical
`updatedAt`, and a timestamp cursor either returns them forever or steps over the ones it
did not reach. The cursor carries a `(updatedAt, id)` position per collection, which
totally orders the rows and always makes progress.

`syncedAt` is stored only when the server reports the run complete. Storing it mid-run
would skip every page not yet fetched — an earlier draft did exactly that, and dropped
everything past the first page.

Sync runs at the four moments something has actually changed: launch, returning to the
foreground, regaining connectivity, and when a queued entry's backoff expires. Not on a
timer — a timer wakes the radio on a schedule unrelated to whether there is anything to
send, which on a phone is battery spent for nothing.

### Deletions

Not tracked with tombstones. Each pull returns the server's authoritative record counts;
when the device holds _more_ than the server says exists, something was deleted elsewhere
and the client re-pulls from scratch.

A tombstone table is the more precise answer and the right one at a scale this product
does not have. What matters is that divergence is detectable, and counts achieve that for
four columns instead of four tables.

## Client-assigned ids

A phone with no signal has to name a brand-new opponent _and_ reference them from the
match in the same breath. It cannot wait for the server to issue an id, so it generates
UUIDs for the match, the session and any new player, and the server adopts them.

Without this, the server would assign its own ids, the next sync would return the same
match under a different one, and the device would show it twice — permanently.

The server declines the supplied id in two cases, and both are right:

- **The name already belongs to somebody.** Two records for one person would split every
  statistic about them. The existing player wins; the client reconciles on its next pull.
- **A session already exists for that day and venue.** Two matches on one evening are one
  session, which is more useful than honouring an id the device invented in ignorance of
  the first match.

## Authentication

Browsers get httpOnly cookies, where XSS cannot reach the token. A native app has no
equivalent, so it sends `X-Client-Kind: native` and receives tokens in the response body,
which it puts in the iOS Keychain or Android Keystore.

Stored with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. That keeps them out of iCloud Keychain and
encrypted backups, so restoring a backup onto a new phone does not silently hand it a live
session. The cost is signing in again after a device transfer, which is the right trade for
a credential.

Refresh is single-flight. When an access token expires every screen's request fails at
once; without deduplication each would start its own refresh, and since refresh tokens
rotate and a reused one revokes the whole family, the second would sign the user out.

Being offline at launch never signs anyone out. The app works without a connection by
design, so a failed `/auth/me` is not evidence the session is invalid — only the server
actually rejecting the token clears it.

## Analytics on the device

Every figure is computed locally from raw matches using the same `aggregate` from
`@badminton/analytics` that the server calls. Same function, same inputs, same answer.

This is why that package is framework-free with no I/O: it runs in Node on the server and
in Hermes on the phone. A server-computed dashboard would be wrong until the queue drained
and unavailable with no signal — both unacceptable for the screen the app opens on.

**Unknown is never zero.** A rate with a zero denominator is `null` and renders as an em
dash. "No matches yet" and "a win rate of 0%" are different facts, and a dashboard that
draws them identically is lying about one of them.

Every breakdown shows its sample size. 100% from one match and 62% from forty are not
comparable, and a bare percentage invites reading them as though they were.

## Interface decisions

**Every control clears 48pt** — the larger of the iOS (44) and Android (48) minimums. This
app is used standing, one-handed, out of breath. A control that is merely fiddly on a sofa
is unusable at a court.

**Quick match entry opens ready.** Singles preselected, today's date, and the two games
every match has already showing. A third game appears when the first two are split, rather
than sitting empty on every two-game match. Both score fields open the numeric keypad, so
no tap is spent switching layouts.

**Saving is local and immediate.** No spinner, no network. Confirmation is a haptic and
the match appearing in the list behind the sheet — not a dialog to dismiss before the next
match can be recorded.

**Offline is not an error.** It is stated plainly, never in red. A rejected write is the
one thing styled as needing attention, because the server has given a final answer and
only a person can decide what happens next.

**Results carry a letter as well as a colour.** W/L beside the green or red, and each row
is labelled as a sentence so a screen reader announces the match rather than four
disconnected fragments.

## Notifications and the app lock

Neither is requested at launch. A notification prompt before anyone has recorded a single
match is asking to interrupt somebody about data they do not have — and on iOS a refusal
is permanent unless they go and find the setting. Both live in settings.

The device registers itself on every launch regardless. That also populates the list of
signed-in devices, and the OS rotates push tokens: a stale one fails silently, so
notifications just stop with nothing anywhere to say why.

The lock is honest about what it is. The device is already locked by the OS; this covers
the narrower case of somebody handed an unlocked phone. It is a privacy screen over a
personal record, not a second layer of encryption, and the settings copy says so.

Its one real failure mode is locking somebody out of their own history, so:

- Enabling requires a successful check first — switching it on blind is how a sensor that
  does not recognise you becomes permanent.
- Disabling requires one too, or anyone holding the unlocked phone could turn it off.
- The device passcode stays available as a fallback. A cold finger should not mean the app
  cannot be opened, and the passcode protects the device anyway.
- If biometrics are later removed from the phone, the prompt is skipped rather than asked
  unanswerably.

It renders as an overlay, not a wrapper, so the screens underneath stay mounted — a
wrapper would discard the navigation stack and any half-typed match every time the phone
was put down. It re-prompts after a minute in the background; prompting on every glance at
another app is how a lock gets switched off for good.

## Building and releasing

Three variants install side by side under separate bundle identifiers. Not cosmetic:
without it, installing a test build replaces the copy holding your real match database.

| Profile       | Bundle id      | Channel     | Output                      |
| ------------- | -------------- | ----------- | --------------------------- |
| `development` | `…app.dev`     | development | Dev client, simulator + APK |
| `preview`     | `…app.preview` | preview     | Internal APK / TestFlight   |
| `production`  | `…app`         | production  | AAB / IPA for the stores    |

```bash
cd apps/mobile
npx eas login
npx eas init                                        # writes the project id
npx eas build --profile preview   --platform all
npx eas build --profile production --platform all
npx eas submit --profile production --platform all
```

### Over-the-air updates

`runtimeVersion` uses the `appVersion` policy, which is what keeps OTA honest: an update
only reaches a binary built from the same native runtime. Changing native code — adding a
module, bumping the SDK — means a store release, not an OTA push.

```bash
npx eas update --branch production --message "Fix the deuce validation message"
```

Ship JavaScript fixes this way. Do not use it to slip in native changes; the runtime
version is what stops you, and working around it produces a crash on launch that only
affects users who already updated.

### Secrets

Nothing secret goes in `app.config.ts` or any `EXPO_PUBLIC_*` variable. Everything there
is compiled into the binary and readable by anyone who unzips it. That is fine for a base
URL and a variant name, and it is the reason nothing else may join them.

Signing credentials — keystores, `.p8` keys, provisioning profiles — are managed by EAS or
kept outside the repository. `.gitignore` and `.easignore` both exclude them.

## Testing

```bash
npm run test -w @badminton/mobile      # unit tests
npm run typecheck -w @badminton/mobile
npm run bundle:check -w @badminton/mobile
```

The database layer is tested against a **real SQL engine**, not a mock. `expo-sqlite` is a
native module with no JavaScript implementation, so under Jest it is backed by Node 22's
built-in SQLite (`src/testing/expo-sqlite-node.ts`). The bugs worth catching here are SQL
bugs — a comparison against a string date, a transaction that fails to roll back — and a
mock cannot have them.

What that does _not_ cover is native-side behaviour: WAL mode, platform file locking, the
async driver's own queueing. Those need a device.

`bundle:check` is the check that matters on CI. Typecheck and unit tests never exercise
Metro, and Metro is where a monorepo resolution mistake actually surfaces. CI also fails
the build if the bundle exceeds 12 MB, which guards against importing something enormous —
an icon font, a charting engine — that on mobile is download size and cold start, not just
disk.

### What has not been verified here

Signed `.ipa` and `.apk` binaries need Xcode and the Android SDK, neither of which exists
in the environment this was built in. What _is_ verified: the JavaScript bundle exports
cleanly for Android at 1880 modules, types pass, and the unit tests pass. The EAS
configuration is complete and ready to run, but the first `eas build` has not been
executed — expect to supply an `EAS_PROJECT_ID`, and on iOS to work through signing.

## Project layout

```
apps/mobile/
  app/                      Expo Router routes; the file tree is the navigation tree
    (auth)/                 Sign in, register
    (tabs)/                 Today, History, Analytics, Settings
    match/                  record.tsx (modal), [id].tsx (detail)
  src/
    components/             Shared UI, score entry, person picker
    lib/
      api/                  HTTP client, error kinds, headers
      auth/                 Session state
      db/                   SQLite: schema, migrations, cache
      notifications/        Push registration
      repositories/         Recording a match; dashboard and analytics queries
      security/             Biometric lock
      sync/                 Outbox, sync engine, connectivity
      storage/              Keychain-backed tokens
    theme/                  Design tokens mirroring the web app
    testing/                Node-SQLite adapter (test-only)
```

## Extension points

Deliberately not built, and the seams left for them:

- **Live session mode** — the schema already models a session as a container of matches
  with `startedAt` / `endedAt`; the outbox would carry `UPDATE_SESSION` entries.
- **Widgets and watch apps** — the cache is a plain SQLite file in the app group; a widget
  would read it directly rather than calling the API.
- **Sharing a match** — `SyncMatch` is already a complete, self-describing record.
- **Conflict resolution** — currently unnecessary. This is one person's data on their own
  devices, and the realistic conflict is recording the same match twice, which the
  idempotency key already prevents. Three-way merge would be a large amount of code for a
  case that does not arise.
