# Avenra — codebase context

Orientation file for AI sessions. Read this instead of re-exploring the tree.
If something here contradicts the code, the code wins — fix this file.

Repo is `personal_clawd/` (legacy name; the product is **Avenra**). It began as
a personal Telegram bot ("The Claw"), so git history and some table/column names
still use Telegram vocabulary.

---

## 1. The three components

| Path | What | Runtime |
|---|---|---|
| `webapp/` | **The product.** React + Vite SPA, Vercel serverless API under `webapp/api/` | Vercel, root dir = `webapp/` |
| `bot.py`, `gym_*.py`, `coaching_pipeline.py` | Telegram ingestion bot + nightly coaching pipeline | Python on a VM |
| `index.html`, `landing.html`, `signup.html`, `CNAME` | Marketing site | GitHub Pages |

**Almost all work happens in `webapp/`.** It imports nothing outside itself.
The bot and webapp are coupled *only* through the shared Supabase database.

⚠️ Repo-root `index.html` is the marketing page. `webapp/index.html` is the SPA
shell. Easy to edit the wrong one.

---

## 2. The user-identity model (read this before touching any query)

There are **three** identifiers for one person:

```
auth.users.id (UUID)          ← Supabase Auth, what the browser holds
      │
      │  user_auth  (auth_user_id → telegram_user_id)
      ▼
telegram_user_id (BIGINT)     ← the real partition key on ALL training data
      │
      ▼
users.telegram_user_id        ← account/status record (email, active|pending)
```

- **Every training table is keyed on `telegram_user_id`, not the auth UUID.**
  `sets`, `sessions`, `cycles`, `profile`, `program_state` all use it.
- `strava_connections` / `strava_activities_normalized` are the exception —
  they key on `auth_user_id`.
- Web-only users still get a synthetic `telegram_user_id` (minted in
  `api/admin.js` as `Date.now()*1000 + randomInt(1000)`).
- `link_auth_account()` RPC (in `webapp_schema.sql`) creates the mapping after
  magic-link login by matching on email.

`lib/auth.js → authenticateUser(req)` is the single entry point for all of
this. It returns `{ supabase, user, uid }` where **`uid` is the
`telegram_user_id`**. Pass `{ requireLink: false }` to allow unlinked accounts
(`uid` may then be null).

---

## 3. Database

Schema lives in three SQL files, applied by hand in the Supabase SQL editor.
**There are no migrations and no migration tool.**

| File | Contents |
|---|---|
| `schema.sql` | `sets`, `sessions`, `cycles`, `profile`, `users`, `link_tokens`, signup RPCs |
| `coaching_schema.sql` | `program_state`, `program_updates`, `program_change_log` (Python pipeline) |
| `webapp_schema.sql` | `user_auth`, RLS policies, `link_auth_account()` RPC, plus the reconstructed tables and RLS in §8–9 |

⚠️ **Schema drift.** `bug_reports`, `consent_records` and `deletion_requests`
existed only in the live Supabase project; `webapp_schema.sql` §8 now carries DDL
for them **reconstructed from application code**, not dumped from the database.
It is `IF NOT EXISTS` throughout, so it's a fresh-install fallback rather than a
source of truth — diff it against the live schema before trusting it.

🔴 **`chat_messages` does not exist in the live database.** Verified against the
project 2026-07-26: `to_regclass('public.chat_messages')` returns null. It is not
drift — the table was never created, and `api/chat.js`, `api/lift.js` and
`lib/rate-limit.js` have all been writing to and reading from a missing table.
`rate_limits` is *not* it (that's the Python bot's daily `api_calls` counter,
keyed on `telegram_user_id`). **Run `webapp_schema.sql` §8 before deploying any
build where `lib/rate-limit.js` exists** — the limiter fails closed, so a missing
table denies every chat and `/lift` request. The older inline limiter in
`chat.js` ignored the query error and read `null` as `0`, which is why this has
been invisible: AI chat has simply been unmetered rather than broken. `strava_connections` and `strava_activities_normalized` are
deliberately *not* reconstructed (their token/score columns can't be inferred
safely) and must be dumped from the live project.

### Key tables

**`sets`** — one row per set. The core table.
`telegram_user_id, session_id (TEXT, client-generated UUID), date (DATE),
exercise (TEXT, free-form), set_num, weight_kg (NUMERIC, always kg),
reps, rpe, rir, note, note_type, injury_flag, injury_body_part,
extras (JSONB), raw_input, extraction_model`

**`sessions`** — one row per *closed* session. `session_id` is UNIQUE.
A session exists in `sets` from the first log; the `sessions` row is only
written by `/done`. So **sets with no matching sessions row = session in
progress**. Several code paths depend on this.

**`profile`** — key/value store, `UNIQUE (telegram_user_id, key)`.
Known keys: `units` (`metric`|`imperial`), `log_units` (`kg`|`lbs`),
`coaching_style` (`balanced`|`focused`|`supportive`), `training_notes`,
`equipment`, `experience_level`, `experience_years`, `chronic_injuries`,
`age`, `height_cm`, `weight_kg`. Keys starting with `_` are internal server
state, not user data — see "Internal profile keys" in §5.

### Weights and units — the one rule
**`weight_kg` is always stored in kilograms.** Conversion to lbs happens at
the display/prompt layer only. `profile.units` controls display; the separate
`profile.log_units` controls how an unmarked number in a log message is
interpreted at parse time.

Exception to watch: `api/today-plan.js` returns plan weights in the field
`weightKg` but populates it in **lbs** for imperial users (see its `unitsNote`).
The frontend renders it verbatim.

### RLS
**Verified against the live project 2026-07-26: every table in `public` already
has `rowsecurity = true`.** §9 of `webapp_schema.sql` is therefore a no-op on
this install; it exists for fresh ones.

`sets`, `sessions`, `cycles` and `user_auth` have owner-read `SELECT` policies —
the browser reads these directly with the anon key, scoped by RLS. `sets`,
`sessions`, `cycles`, `profile` and `feedback` *also* carry a
`service role only` policy (`FOR ALL USING (false)`) that `webapp_schema.sql`
doesn't declare. That combination is deliberate and safe: permissive policies OR
together, so `SELECT` resolves to `(owner check) OR false` while
INSERT/UPDATE/DELETE see only `false` and are denied. `bug_reports`,
`consent_records`, `deletion_requests`, `users`, `link_tokens`, `rate_limits`,
`allowlist` and the Strava tables have RLS **with no policy** — the API reads
them with the service-role key, so deny-by-default costs nothing.

🔴 **Exception — `program_state`, `program_updates`, `program_change_log`** each
have a `FOR ALL ... USING (true) WITH CHECK (true)` policy granted to
`authenticated`. Any logged-in user can read *and write* every other user's
program data straight from PostgREST with the anon key. These come from
`coaching_schema.sql`, not `webapp_schema.sql`, so running the webapp migration
does not fix it. Scope them to the owner or make them service-role-only.

All writes go through `webapp/api/*`, which uses the **service-role key and
bypasses RLS** — every server query must therefore carry an explicit
`.eq('telegram_user_id', uid)` guard. This is the main security invariant in
the codebase.

---

## 4. `webapp/` layout

```
api/            Vercel serverless functions — one file = one route
  chat.js         POST  streamed coach chat (SSE). Sonnet.
  lift.js         POST  /lift command. Stage 1 = JSON card (no LLM);
                        ?stage=advice = SSE coaching. Sonnet.
  log.js          POST  natural-language → structured sets. Haiku.
  done.js         POST  close session: classify (Haiku) + summarise (Sonnet)
  today-plan.js   GET   today's plan, cached per day (?refresh=1 to force)
                        · POST modify plan. Sonnet + structured outputs.
  sets.js         POST/PATCH/DELETE individual sets
  insights.js     ?view=history (7-day sessions) | ?view=stats (90-day rollup)
  profile.js      GET/POST profile key-value store
  strava.js       ?action=connect|callback|status|sync|disconnect|webhook|activities
                        no action = daily cron sync
  user-actions.js ?action=consent|request-deletion|update-session
  admin.js        ?resource=users | ?action=reset-onboarding (ADMIN_EMAIL gated)
  bug-reports.js  POST any user · GET/PATCH admin only

lib/            server-only helpers (never imported by src/)
  auth.js            authenticateUser / serviceClient (+ local JWT verify)
  models.js          MODEL_SONNET, MODEL_HAIKU, THINKING/NO_THINKING,
                     cachedSystem(), firstText(), parseJsonResponse()
  rate-limit.js      shared hourly AI-message limit (fails closed)
  is-admin.js        the single admin-email check
  coaching-style.js  tone modifier from profile.coaching_style
  parse-date.js      backdating ("yesterday", "3 days ago", "20th April")
  lift-history.js    /lift matching + history shaping + progression rule
  strava-*.js        client, normalisation, LLM context block

src/pages/      Dashboard(=History) · Today · LogWorkout(=Log+Chat) ·
                Progress · SessionDetail · Admin · Onboarding · Login ·
                Profile/Goals/Preferences · Landing/Privacy/Terms/Support
src/utils/      supabase.js (anon client) · training.js (shared calcs) ·
                units.js (useUnits + formatWeight) ·
                auth-context.jsx (AuthProvider/useAuth) ·
                page-cache.js (tab data SWR cache) · posthog.js
```

### Routes → pages
`/` RootRoute (landing when logged out, **Dashboard** when logged in) ·
`/today` Today · `/log` LogWorkout · `/progress` Progress ·
`/session/:id` SessionDetail · `/chat` **redirects to `/log`** ·
plus `/admin /profile /goals /preferences /login /auth/callback /onboarding`.

⚠️ Naming trap: the **Dashboard** component is the "History" tab at `/`.
`LogWorkout` is *both* the Log tab and the Chat surface — it has a `mode`
state (`'log' | 'chat'`) toggled in-page. Navigate to chat with
`navigate('/log', { state: { mode: 'chat' } })`.

### Navigation performance — the rule
Route elements **remount on every navigation**, so anything a route element
(or `Layout`) does on mount runs on every tab switch. Two rules follow:

1. **Never gate a render on an async auth call.** Session and onboarding state
   come from `AuthProvider` (mounted above `<Routes>`, so it survives
   navigation) via `useAuth()`. This used to be per-route state, which meant a
   full-screen "Loading…" on every single tab switch before the page could
   even start fetching.
2. **Seed page state from `page-cache.js`, then revalidate.** Dashboard,
   Progress, Today and StravaContextCard all read `getCached(...)` in their
   `useState` initialiser so the tab paints instantly, then refresh in the
   background. Call `invalidateCache(prefix)` after any mutation that makes a
   view stale — `LogWorkout` does this on log and on `/done`.

Lazy routes (Progress, Admin, SessionDetail) are prefetched on idle in
`App.jsx`; without that, code splitting would just move the cost to the first
click.

---

## 5. Conventions that matter

**Models** — only ever referenced via `lib/models.js`:
`MODEL_SONNET` (`claude-sonnet-5`) = coaching quality (chat, plan, debrief,
/lift advice), `MODEL_HAIKU` = mechanical parsing (log extraction, session
classification). Change the cost/quality tradeoff there and nowhere else.

⚠️ **Sonnet 5 thinks by default when `thinking` is omitted**, and thinking
tokens come out of `max_tokens` — an omitted `thinking` on a tightly-sized
request truncates the answer. Every Sonnet call site passes `THINKING` or
`NO_THINKING` explicitly. Current split: off for `chat.js` (streamed, protects
time-to-first-token), on for `lift.js` advice, `done.js` summary, and
`today-plan.js`.

⚠️ **`response.content[0]` is not the text block** once thinking is on — the
thinking block comes first. Use `firstText(response)`, never index directly.
For JSON-returning calls use `parseJsonResponse(firstText(res))`.

`today-plan.js` uses **structured outputs** (`output_config.format` with
`PLAN_SCHEMA`) so the plan JSON is schema-enforced rather than parsed hopefully.
Structured-output schemas need `additionalProperties: false` and every property
listed in `required` — express optional fields as nullable instead.

`cachedSystem(staticText, dynamicText)` wraps a system prompt as a cacheable
block. Per-user text **must** go in `dynamicText` so the cached prefix stays
byte-identical. Caching only engages above a per-model floor (1024 tokens on
Sonnet 5, 4096 on Haiku 4.5) — only `chat.js` clears it today.

**Streaming protocol** — `chat.js` and `lift.js?stage=advice` both emit
`data: {"text":"…"}\n\n` frames terminated by `data: [DONE]`. Headers are
written lazily on the first delta so a pre-stream failure can still return
JSON with a proper status code. The client reader is
`consumeTextStream()` in `LogWorkout.jsx` — reuse it, don't rewrite it.

**LLM JSON responses** — always fenced-code-stripped then `JSON.parse` in a
try/catch with a non-LLM fallback. Follow the existing pattern.

**Client state keys** (localStorage / sessionStorage):
`avenra-session` (active session id + startedAt) · `avenra-active-plan` ·
`avenra-feed` (log feed, 120-min expiry) · `avenra-log-draft` ·
`avenra-profile-ok` · `avenra-onboarded` · `avenra-ai-notice-shown` ·
`avenra-history-<date>` · `avenra-units`.

**Internal profile keys** — `profile` rows whose key starts with `_` are server
state, not user data: `_cached_plan` (today's plan), `_last_plan_at`
(rate-limit stamp), `_exercise_vocab` (distinct exercise names). `api/profile.js`
strips them from GET responses and from the `hasProfile` count, and refuses to
write them. Any new internal key must follow that convention.

**Styling** — plain CSS, one `.css` per component/page, tokens in
`src/index.css` (`--bg --surface --border --text --muted --accent
--accent-dim --danger --radius`). Dark theme only. No CSS framework.

**Error handling** — API returns `{ error }` with a real status code;
some endpoints return `200 { ok: false, message }` for expected user-facing
failures (e.g. unparseable log input). Check both in new client code.

---

## 6. Environment

Browser-visible (`VITE_*`, set in Vercel): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_EMAIL`, `VITE_POSTHOG_KEY`,
`VITE_POSTHOG_HOST`.

Server-only: `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `ADMIN_EMAIL`,
`CRON_SECRET`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`,
`STRAVA_WEBHOOK_VERIFY_TOKEN`, `STRAVA_TOKEN_ENC_KEY`.

Optional: `SUPABASE_JWT_SECRET` (Supabase dashboard → Settings → API → JWT
Secret). When set, `lib/auth.js` verifies access tokens locally instead of
calling GoTrue, removing a network round trip from every API request. Without
it the code falls back to `supabase.auth.getUser()`, so it is safe to omit.

⚠️ Server code reads the Supabase URL from `VITE_SUPABASE_URL` (not a
server-prefixed name) — it must be set in the Vercel project too.

```bash
cd webapp
npm install
npm run dev      # Vite only — /api/* is NOT served; use `vercel dev` for those
npm run build
```

`vercel.json`: SPA rewrite, 60s function `maxDuration`, daily Strava cron at
04:00 UTC, CORS headers pinned to `https://getavenra.com` (the root `CNAME`
says `avenra.biggsdata.com` — these disagree).

---

### ⚠️ The 12-function limit
Vercel's Hobby plan allows **at most 12 serverless functions per deployment**,
and `api/` is currently at exactly 12. **Adding any new file to `api/` will
fail the build.** New endpoints must fold into an existing handler behind a
query param — the established pattern here (`strava.js`, `user-actions.js`,
`admin.js` and `insights.js` are all consolidated handlers for this reason).

---

## 7. Known traps

1. **`sessions` row = closed session.** Anything counting "workouts" from
   `sessions` misses the in-progress one. `chat.js` handles this explicitly.
2. **PostgREST caps responses at 1000 rows.** `Dashboard` now pages at 30 and
   `log.js` uses the cached vocabulary, but `Progress` and
   `Today.loadHistory` are still unbounded. Paginate or aggregate.
3. **`exercise` is free text.** Normalise with
   `normalizeExercise()` (`src/utils/training.js`) or `normalize()`
   (`lib/lift-history.js`) before comparing. The DB has an index on
   `lower(exercise)`.
4. **`.single()` errors on zero rows** — several call sites rely on ignoring
   that error. Prefer `.maybeSingle()` in new code.
5. **`/done` is not idempotent** — `sessions.session_id` is UNIQUE, so a
   double-submit surfaces as a 500.
6. **Units** — display conversion lives only in `src/utils/units.js`. Anything
   rendering a weight uses `useUnits()` + `formatWeight`; any *input* labelled
   with the active unit must convert back with `fromDisplayWeight` before
   writing to `weight_kg`.
7. **Python bot and webapp share tables.** A column change can break the
   other runtime; grep both before altering `sets`/`sessions`.

See `docs/CODE_REVIEW.md` for the full audit and what has already been fixed.
