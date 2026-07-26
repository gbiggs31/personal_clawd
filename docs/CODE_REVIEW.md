# Avenra webapp — code review

Audit of `webapp/` (API, lib, pages, schema) as of 2026-07-26.
Ordered by impact. ✅ = fixed, ⬜ = still open (see the table at the bottom).

The **Fixed in this pass** and **Model configuration** sections at the end are
the current summary — the per-item write-ups below are the original diagnosis,
kept because they explain *why* each change was made.

---

## Broken features

### ✅ 1. Every session edit fails with 405
`src/pages/SessionDetail.jsx:591` sends `PATCH /api/user-actions?action=update-session`,
but `api/user-actions.js:10` rejected anything that wasn't `POST`. Editing a
session's type, note, duration, or coach note was dead across the app — the UI
surfaced it as a generic "Failed to update session".

**Fix:** the handler now accepts `POST` and `PATCH`.

### ✅ 2. The daily Strava sync has never run
`vercel.json` schedules `/api/strava` at 04:00. Vercel Cron invokes with **GET**
and `Authorization: Bearer $CRON_SECRET`, but `api/strava.js:23` only took the
cron path on `POST` with an `x-cron-secret` header. Every scheduled run fell
through to `default:` and returned `400 Missing or invalid action`. Silent,
because nothing alerts on cron responses.

**Fix:** the cron branch is now method-agnostic (gated on absence of `action`)
and accepts either the Bearer token or the legacy header.

### ✅ 3. "Ask Avenra" button lands in the wrong mode
`Dashboard.jsx:482` linked to `/chat`, which `App.jsx:152` redirects to `/log` —
dropping the router state that selects chat mode. The button opened the Log tab.

**Fix:** links directly to `/log` with `state={{ mode: 'chat' }}`.

### ✅ 4. Service worker can throw on asset caching
`public/sw.js:42` called `response.clone()` *inside* the `caches.open().then()`
callback. By then the browser may already have consumed the body, giving
`TypeError: Response body is already used` and a failed asset fetch.

**Fix:** clone synchronously before the async cache open.

### ✅ 5. Serverless timeouts were shorter than the LLM timeouts
No `maxDuration` was configured, so functions ran on the platform default
(10–15s) while `chat.js` waited up to 45s and `today-plan.js`/`done.js` up to
30s. Long plan generations and session summaries were being killed mid-flight
and surfacing as generic 500s.

**Partially fixed:** `vercel.json` now sets `maxDuration: 60` for `api/*.js`.
Verify against your Vercel plan (Hobby caps at 60s).

### ✅ 6. `chat_messages` and five other tables aren't in any schema file
`chat_messages` (chat + `/lift` rate limiting), `bug_reports`,
`consent_records`, `deletion_requests`, `strava_connections`,
`strava_activities_normalized` exist only in the live Supabase project. A fresh
deploy from this repo produces a half-broken app, and the rate limiter fails
open — `count` comes back `null`, `(null ?? 0) >= 30` is false, so **an unknown
table silently disables the limit**. Dump the live schema into
`webapp_schema.sql`, and make the rate-limit check fail closed on query error.

---

## Latency

### ✅ 7. `/today` regenerates a Sonnet plan on every visit
`Today.jsx:337` calls `loadPlan()` on mount, unconditionally. Each visit is a
full Sonnet generation with 30 days of history in the prompt — several seconds
of blank card and a full model call per navigation, including a back-button
return. `today-plan.js:255` even sets `Cache-Control: no-store`.

The 30-second rate limit only stops hammering; it doesn't prevent the second
visit five minutes later from regenerating.

**Suggested:** persist the generated plan against `(telegram_user_id, date)` —
either a `daily_plans` table or a `profile` key — and serve it for the rest of
the day. The `↻` button already exists for explicit regeneration. This is
probably the single biggest cost and latency win available.

### ✅ 8. Two sequential Supabase round trips before any request does work
`lib/auth.js` calls `supabase.auth.getUser(token)` (network call to GoTrue) and
then a `user_auth` lookup, sequentially, on **every** API request. That's
~150–400ms of fixed overhead before the handler starts.

**Suggested:** verify the JWT locally with the project's JWT secret
(`jose`/`jsonwebtoken`) to eliminate the first hop, and cache the
`auth_user_id → telegram_user_id` mapping in-process (it effectively never
changes) to eliminate the second on warm invocations.

### ✅ 9. Strava context is fetched serially before the model call
`chat.js:122` and `today-plan.js:167` `await getStravaContext(...)` *after* the
main `Promise.all`. That helper itself makes two sequential queries. Two extra
serial round trips sit directly in the user's wait.

**Suggested:** move `getStravaContext(...).catch(() => null)` into the existing
`Promise.all`. `api/lift.js` already does this — copy that shape.

### ✅ 10. `log.js` scans the user's whole `sets` table on every log
`api/log.js:185` selects the `exercise` column for **all** of the user's sets,
just to build a distinct name list for the prompt. It grows without bound, and
past 1000 rows PostgREST truncates it, so the known-exercise list silently
degrades — which is exactly what drives the name-normalisation rules in the
extraction prompt.

**Suggested:** a Postgres RPC returning `DISTINCT exercise` (the
`lower(exercise)` index covers it), cached in `profile` and invalidated when a
genuinely new name is inserted.

### ✅ 11. Dashboard loads everything, always
`Dashboard.jsx:262` fetches up to 500 sessions, then **all sets for all 500**
via `.in('session_id', ids)` — a 500-element `IN` list in a URL, hitting the
1000-row cap on the set rows. Then it computes three `useMemo` passes over the
whole history. First paint of the default route degrades linearly with account
age.

**Suggested:** paginate to ~30 sessions with infinite scroll, and push the
per-session highlight rollup into a Postgres view.

### ✅ 12. localStorage write per streamed token
`LogWorkout.jsx:368` persists the feed on every `feed` change. During streaming
that fires once per delta, each time `JSON.stringify`-ing the entire feed
including all history. Synchronous main-thread work per token — the likely
cause of any stutter in long replies.

**Suggested:** debounce `persistFeed` (~500ms) or skip it while `loading`.

### ✅ 13. 1.08 MB JS bundle, no code splitting
Every route loads `recharts` (only `/progress`) and `react-markdown` + `remark-gfm`
(only `/log`). 305 kB gzipped before anything renders.

**Suggested:** `React.lazy` the Progress and Admin routes; that alone should cut
initial JS by roughly half.

### ✅ 14. Prompt caching is a no-op on two of three call sites
`cachedSystem()` marks the block `ephemeral`, but Anthropic only caches above a
minimum length — 1024 tokens for Sonnet, **2048 for Haiku**.
- `log.js`: `EXTRACTION_SYSTEM` is ~900 tokens on Haiku → never caches.
- `done.js`: `SESSION_SUMMARY_SYSTEM` is ~280 tokens on Sonnet → never caches.
- `chat.js`: includes 90 days of history, so this one does work.

Not a bug, but the comment in `models.js` claims a saving that two of the three
callers don't get. Either accept it or pad/restructure those prompts.

---

## Correctness

### ✅ 15. Unit preference ignored on three pages
`Progress.jsx` (metric `unit: 'kg'` hard-coded), `Dashboard.jsx:346`
(`${top.weight_kg}kg`), `SessionDetail.jsx:43` and its edit form labels, and
`training.js:85` `compareTopSets` all emit kg regardless of `profile.units`.
Imperial users get lbs in chat, plan, and log confirmations but kg everywhere
else.

**Suggested:** a `useUnits()` hook reading the profile once, and move
`formatWeight` into `src/utils/training.js` so there's one implementation.
There are currently **four** copies of `kgToLbs` (`chat.js`, `log.js`,
`done.js`, `Today.jsx`) plus the new one in `lib/lift-history.js`.

### ✅ 16. `/done` backdating rewrites unrelated sets
`done.js:186` updates the date on **all** sets in the session when a date is
parsed from the note. Sets deliberately logged with their own date get
overwritten.

### ✅ 17. Duration parsing is greedy
`parseDurationFromNote` (`done.js:8`) matches the first `\d+\s*m` anywhere in
the note. `/done felt strong, 3 min rest between sets` records a 3-minute
session. Anchor it to duration-like phrasing ("took 45 min", "45 minute
session") or require it at the start/end of the note.

### ✅ 18. `/done` double-submit surfaces as a 500
The "already closed" check at `done.js:127` and the insert at `:227` aren't
atomic; a fast double-tap has both pass the check, and the second insert
violates the UNIQUE constraint. Use `upsert` with `onConflict: 'session_id'`
and `ignoreDuplicates`, or catch code `23505` and return the friendly
"already closed" message.

### ✅ 19. `today-plan.js` corrupts the onboarding check
Its rate limiter writes a `_last_plan_at` row into `profile`
(`today-plan.js:133`). `api/profile.js:26` computes
`hasProfile: Object.keys(profile).length > 0`, so a user who has never onboarded
but hit the plan endpoint reads as onboarded and skips `/onboarding`. It will
also appear as a stray field in any UI that iterates profile keys.

**Suggested:** move the stamp out of `profile`, or exclude `_`-prefixed keys
from both the `hasProfile` count and the GET payload.

### ✅ 20. `Progress.jsx` exercise lookup is fragile
`.ilike('exercise', selectedEx)` at `:274` uses the *normalised* name
(whitespace collapsed) against raw stored values, so `"bench  press"` with a
double space never matches. And because the value isn't escaped, an exercise
containing `%` or `_` behaves as a wildcard.

### ✅ 21. Substring exercise matching over-counts
`exerciseMatch` (`LogWorkout.jsx:48`) treats any substring relation as a match,
so logging "Row" credits progress against "Barbell Row", "Upright Row" and
"Cable Row" simultaneously in the session card's set counts.

---

## Security / hygiene

### ⬜ 22. `service_account.json` is on disk with live-looking credentials
It's correctly listed in `.gitignore:207` and **not** tracked by git — but it's
sitting in a OneDrive-synced folder. If those Google credentials are real,
rotate them and move the file outside the synced tree. Same check for `.env`
(also gitignored, also synced).

### ✅ 23. RLS status unverified on the newer tables
`profile`, `chat_messages`, `bug_reports`, `consent_records`,
`deletion_requests` have no `ENABLE ROW LEVEL SECURITY` anywhere in the repo.
The frontend doesn't query them directly, so nothing breaks — but if RLS is off
in the live project, anyone with the (public, browser-visible) anon key can read
every user's profile, bug reports and consent records directly from PostgREST.

**Action:** confirm in the Supabase dashboard; enable RLS with owner-only
policies and check it into `webapp_schema.sql`.

### ⬜ 24. CORS origin disagrees with the CNAME
`vercel.json` pins `Access-Control-Allow-Origin` to `https://getavenra.com`;
the repo-root `CNAME` says `avenra.biggsdata.com`. Inert today (the SPA is
same-origin) but it will bite the first time something calls the API
cross-origin.

### ✅ 25. Admin gate is duplicated
`api/admin.js` re-implements token extraction and admin checks instead of using
`authenticateUser` + the `isAdmin()` helper that already exists in
`api/bug-reports.js:3`. Two places to get an authorisation check wrong.

### ✅ 26. Unbounded service-worker cache
`sw.js` caches content-hashed assets forever and only evicts on cache-name
change. Every deploy adds a new set. Bump `CACHE` on release, or cap entries.

---

## Fixed in this pass

Round 1 (initial review):

| # | File | Change |
|---|---|---|
| 1 | `api/user-actions.js` | Accept `PATCH` as well as `POST` |
| 2 | `api/strava.js` | Cron auth accepts Vercel's GET + Bearer form |
| 3 | `src/pages/Dashboard.jsx` | "Ask Avenra" opens `/log` in chat mode |
| 4 | `public/sw.js` | Clone response before async cache write |
| 5 | `vercel.json` | `maxDuration: 60` for all API functions |

Round 2 (backlog + model upgrade):

| # | File | Change |
|---|---|---|
| 6 | `lib/rate-limit.js` (new) | Shared limiter that **fails closed** on query error; `webapp_schema.sql` gains the missing table DDL |
| 7 | `api/today-plan.js`, `src/pages/Today.jsx` | Plan cached per `(user, date)` in the profile KV store; ↻ sends `?refresh=1` |
| 8 | `lib/auth.js` | Local HS256 JWT verification (opt-in via `SUPABASE_JWT_SECRET`) + in-process uid cache |
| 9 | `api/chat.js`, `api/today-plan.js` | Strava context moved into the existing `Promise.all` |
| 10 | `api/log.js` | Exercise vocabulary cached in `profile._exercise_vocab`, extended incrementally |
| 11 | `src/pages/Dashboard.jsx` | Paged to 30 sessions with a "Load more" control; `exerciseMap` derived |
| 12 | `src/pages/LogWorkout.jsx` | `persistFeed` debounced 500ms |
| 13 | `src/App.jsx` | `React.lazy` on Progress / Admin / SessionDetail — initial JS 1,078 kB → 648 kB |
| 14 | `lib/models.js` | Comment corrected with the real per-model cache minimums |
| 15 | `src/utils/units.js` (new) | `useUnits()` + one `formatWeight`; Progress, Dashboard and SessionDetail now honour the preference (including converting edit-form input back to kg) |
| 16 | `api/done.js` | Backdating only moves sets still on today's default date |
| 17 | `api/done.js` | Duration parsing anchored to duration phrasing; also fixed "45 mins" never matching |
| 18 | `api/done.js` | Unique-violation (23505) returns "already closed" instead of a 500 |
| 19 | `api/profile.js` | Underscore-prefixed internal keys excluded from GET and from `hasProfile` |
| 20 | `src/pages/Progress.jsx` | Matches on exact raw exercise strings instead of `ilike` |
| 21 | `src/pages/LogWorkout.jsx` | `exerciseMatch` uses whole-token subset matching |
| 23 | `webapp_schema.sql` | RLS enabled on `profile` and the five other unprotected tables |
| 25 | `api/admin.js` | Uses `authenticateUser` + shared `lib/is-admin.js` |
| 26 | `public/sw.js` | Cache capped at 60 entries, trimmed oldest-first |

### Still open — needs you, not code

| # | Item | Why it isn't fixed here |
|---|---|---|
| 22 | `service_account.json` / `.env` in a OneDrive-synced folder | Rotate the credentials and move the files; nothing to change in the repo (both are correctly gitignored) |
| 24 | CORS origin (`getavenra.com`) disagrees with `CNAME` (`avenra.biggsdata.com`) | I don't know which domain is live. Inert today — the SPA is same-origin |
| — | `webapp_schema.sql` §8 tables | Reconstructed from application code, not dumped. Diff against the live project and replace with a real `pg_dump --schema-only` |
| — | RLS verification | Run the query at the bottom of `webapp_schema.sql` and confirm every table shows `rowsecurity = true` |

## Model configuration

`MODEL_SONNET` moved from `claude-sonnet-4-6` to `claude-sonnet-5`, and thinking is now set explicitly at every call site — Sonnet 5 runs adaptive thinking when `thinking` is omitted, and those tokens come out of `max_tokens`.

| Call site | Thinking | `max_tokens` | Rationale |
|---|---|---|---|
| `chat.js` | off | 1024 → 1500 | Streamed; thinking would stall time-to-first-token |
| `lift.js` advice | **on** | 400 → 2500 | The card is already rendered, so a pause is free |
| `done.js` summary | **on** | 512 → 2500 | Once per session |
| `today-plan.js` | **on** | 1024 → 4000 | Now at most once per day, thanks to the cache |
| `log.js` parse | Haiku, unchanged | 2048 | Highest-volume call; mechanical extraction |

`today-plan.js` also moved to **structured outputs** (`output_config.format` with a JSON schema), which removes the fence-stripping-and-hope parse that previously surfaced as a 500.

---

## Round 3 — navigation latency

Tab-to-tab switching felt slow. The root cause was not data volume but a
blocking auth check on every navigation.

### 27. Full-screen `Loading…` on every tab switch

`RequireAuth` and `RootRoute` are route elements, so React Router remounted
them on each navigation. Both started with `session === undefined` and returned
`<div className="loading-full">Loading…</div>` until an async
`supabase.auth.getSession()` resolved — before the page underneath had even
begun fetching. `Layout` then ran a *second* `getSession()` for its admin check.

**Fixed:** `src/utils/auth-context.jsx` — an `AuthProvider` mounted above
`<Routes>` resolves session and onboarding state once and shares it. Route
guards read it synchronously, so after the first load navigation renders with
no blocking call and no flash. `Layout` derives `isAdmin` from the same
context, and its service-worker registration is guarded at module scope.

### 28. Every tab refetched its data from scratch

Returning to a tab you left ten seconds ago re-ran the whole load: Dashboard
re-queried sessions and sets, Progress re-scanned the entire `sets` table for
its exercise list, Today re-pulled 120 days of history plus the plan, and
`StravaContextCard` re-hit `/api/strava?action=status`.

**Fixed:** `src/utils/page-cache.js` — an in-memory stale-while-revalidate
cache. Pages seed state from it synchronously (instant paint) and refresh in
the background. `invalidateCache(prefix)` is called from `LogWorkout` after a
log and after `/done`. Deliberately not persisted, so a hard refresh is always
a clean read.

### 29. Code splitting moved cost to the first click

Round 2's `React.lazy` cut the initial bundle from 1,078 kB to 648 kB, but the
first visit to Progress then had to fetch a 403 kB chunk at click time — a
regression on that specific navigation.

**Fixed:** `prefetchRouteChunks()` in `App.jsx` warms the Progress and
SessionDetail chunks via `requestIdleCallback` after the app settles.

### Per-navigation work, before and after

| | Before | After |
|---|---|---|
| Blocking auth calls | 2 × `getSession()` | 0 |
| Full-screen loading flash | every switch | first load only |
| Data fetches before paint | all of them | 0 (cached seed) |
| Progress first click | 403 kB fetched at click | prefetched on idle |

### Still unbounded

`Progress` selects the `exercise` column for every set the user has ever
logged, and `Today.loadHistory` pulls 120 days of sets. Both are now cached, so
they cost once per page load rather than once per visit — but both still hit
PostgREST's 1000-row cap on a large enough account. The real fix is a
`DISTINCT exercise` RPC for the former and a server-side rollup for the latter.
