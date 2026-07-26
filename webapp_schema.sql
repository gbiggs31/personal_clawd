-- ══════════════════════════════════════════════════════════════════
-- Avenra web app migrations — run in Supabase SQL editor
--
-- Safe to re-run. Postgres has no CREATE POLICY IF NOT EXISTS, so each
-- policy below is preceded by DROP POLICY IF EXISTS. Without that, a
-- second run aborts on the first existing policy — and because the SQL
-- editor runs the whole script in one transaction, the abort rolls back
-- everything after it too.
-- ══════════════════════════════════════════════════════════════════

-- 1. Mapping: Supabase Auth user ↔ Telegram user ID
CREATE TABLE IF NOT EXISTS user_auth (
  auth_user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_user_id BIGINT  NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (auth_user_id)
);

ALTER TABLE user_auth ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_auth: owner can read" ON user_auth;
CREATE POLICY "user_auth: owner can read"
  ON user_auth FOR SELECT
  USING (auth_user_id = auth.uid());

-- 2. RLS on sets (service role bypasses this; web app uses auth.uid() path)
ALTER TABLE sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sets: owner can read" ON sets;
CREATE POLICY "sets: owner can read"
  ON sets FOR SELECT
  USING (
    telegram_user_id IN (
      SELECT telegram_user_id FROM user_auth WHERE auth_user_id = auth.uid()
    )
  );

-- 3. RLS on sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions: owner can read" ON sessions;
CREATE POLICY "sessions: owner can read"
  ON sessions FOR SELECT
  USING (
    telegram_user_id IN (
      SELECT telegram_user_id FROM user_auth WHERE auth_user_id = auth.uid()
    )
  );

-- 4. RLS on cycles
ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cycles: owner can read" ON cycles;
CREATE POLICY "cycles: owner can read"
  ON cycles FOR SELECT
  USING (
    telegram_user_id IN (
      SELECT telegram_user_id FROM user_auth WHERE auth_user_id = auth.uid()
    )
  );

-- 5. RPC: called once after magic-link login to create the auth↔telegram mapping
--    Uses auth.uid() so it can only map the currently authenticated user.
CREATE OR REPLACE FUNCTION link_auth_account()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_uid   BIGINT;
BEGIN
  -- Get email from the auth.users row for the logged-in session
  SELECT email INTO v_email
  FROM auth.users
  WHERE id = auth.uid();

  IF v_email IS NULL THEN
    RETURN 'no_auth_session';
  END IF;

  -- Find the matching Avenra user (must have completed signup)
  SELECT telegram_user_id INTO v_uid
  FROM users
  WHERE email = v_email AND status = 'active';

  IF v_uid IS NULL THEN
    RETURN 'not_found';
  END IF;

  -- Create mapping (idempotent)
  INSERT INTO user_auth (auth_user_id, telegram_user_id)
  VALUES (auth.uid(), v_uid)
  ON CONFLICT (auth_user_id) DO NOTHING;

  RETURN 'ok';
END;
$$;

GRANT EXECUTE ON FUNCTION link_auth_account() TO authenticated;

-- 6. Make sure sessions has the summary column (skip if already exists)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS summary TEXT;

-- ══════════════════════════════════════════════════════════════════
-- 7. Columns the webapp writes that schema.sql never declared
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE sets     ADD COLUMN IF NOT EXISTS raw_input        TEXT;
ALTER TABLE sets     ADD COLUMN IF NOT EXISTS extraction_model TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS coaching_note    TEXT;

-- ══════════════════════════════════════════════════════════════════
-- 8. Tables the webapp queries that existed only in the live project
--
-- ⚠️ RECONSTRUCTED FROM APPLICATION CODE, not dumped from the database.
-- Every statement is IF NOT EXISTS, so running this against the live
-- project is a no-op for tables that already exist. Treat these as a
-- fresh-install fallback — diff them against the live schema and
-- replace this section with a real `pg_dump --schema-only` when you can.
-- ══════════════════════════════════════════════════════════════════

-- Chat/AI usage metering. Backs the 30-messages-per-hour rate limit in
-- api/chat.js and api/lift.js — if this table is missing the limiter denies
-- every request (it fails closed), so it must exist for AI features to work.
CREATE TABLE IF NOT EXISTS chat_messages (
  id               BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT,
  auth_user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,          -- 'user' | 'assistant'
  message_length   INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The rate-limit query filters on exactly these three columns.
CREATE INDEX IF NOT EXISTS idx_chat_messages_rate_limit
  ON chat_messages (auth_user_id, role, created_at DESC);

CREATE TABLE IF NOT EXISTS bug_reports (
  id               BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT,
  description      TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'bug',   -- 'bug' | 'suggestion' | 'other'
  page_url         TEXT,
  status           TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'resolved'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS consent_records (
  id                BIGSERIAL PRIMARY KEY,
  auth_user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  privacy_accepted  BOOLEAN NOT NULL DEFAULT FALSE,
  terms_accepted    BOOLEAN NOT NULL DEFAULT FALSE,
  beta_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  privacy_version   TEXT,
  terms_version     TEXT,
  accepted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deletion_requests (
  id           BIGSERIAL PRIMARY KEY,
  auth_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NOTE: strava_connections and strava_activities_normalized are deliberately
-- NOT recreated here. Their real shape (encrypted token columns, the derived
-- fatigue scores) can't be inferred safely from the read paths in
-- lib/strava-context.js. Dump them from the live project before any fresh
-- install. RLS is still enabled on them below if they exist.

-- ══════════════════════════════════════════════════════════════════
-- 9. Row Level Security on every remaining table
--
-- These tables are only ever read/written by the serverless API using the
-- service-role key, which bypasses RLS — so enabling it changes nothing for
-- the app. What it does change: without it, the browser-visible anon key can
-- read every user's rows straight from PostgREST.
--
-- Deny-by-default: RLS with no policy blocks all anon/authenticated access.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE profile           ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records   ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_requests ENABLE ROW LEVEL SECURITY;

-- Guarded so the script still runs on installs without the Strava integration.
DO $$
BEGIN
  IF to_regclass('public.strava_connections') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE strava_connections ENABLE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public.strava_activities_normalized') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE strava_activities_normalized ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- Verify afterwards: every row should show rowsecurity = true.
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname = 'public' ORDER BY tablename;
