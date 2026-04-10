-- Run this in the Supabase SQL editor for a fresh install.
-- For existing installs, see the ALTER TABLE migration at the bottom.

CREATE TABLE sets (
  id                  BIGSERIAL PRIMARY KEY,
  telegram_user_id    BIGINT NOT NULL,
  session_id          TEXT NOT NULL,
  date                DATE NOT NULL,
  exercise            TEXT NOT NULL,
  set_num             INTEGER,
  weight_kg           NUMERIC,
  reps                INTEGER,
  rpe                 NUMERIC,
  rir                 INTEGER,
  note                TEXT,
  note_type           TEXT,
  injury_flag         BOOLEAN DEFAULT FALSE,
  injury_body_part    TEXT,
  extras              JSONB,
  telegram_message_id BIGINT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sets_user_id            ON sets(telegram_user_id);
CREATE INDEX idx_sets_session_id         ON sets(session_id);
CREATE INDEX idx_sets_date               ON sets(date);
CREATE INDEX idx_sets_exercise           ON sets(lower(exercise));
CREATE INDEX idx_sets_telegram_message_id ON sets(telegram_message_id);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE sessions (
  id               BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  session_id       TEXT NOT NULL UNIQUE,
  date             DATE NOT NULL,
  overall_note     TEXT,
  duration_mins    INTEGER,
  session_type     TEXT,
  cardio_flag      BOOLEAN DEFAULT FALSE,
  abs_flag         BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(telegram_user_id);
CREATE INDEX idx_sessions_date    ON sessions(date);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE cycles (
  id               BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  cycle_id         TEXT NOT NULL UNIQUE,
  start_date       DATE,
  end_date         DATE,
  goals            TEXT,
  workout_plan     TEXT,
  status           TEXT DEFAULT 'active',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cycles_user_id ON cycles(telegram_user_id);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE profile (
  id               BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL,
  key              TEXT NOT NULL,
  value            TEXT NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (telegram_user_id, key)
);

CREATE INDEX idx_profile_user_id ON profile(telegram_user_id);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE users (
  id               BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL UNIQUE,
  first_name       TEXT,
  last_name        TEXT,
  email            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'active'
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_telegram_user_id ON users(telegram_user_id);

CREATE TABLE link_tokens (
  id               BIGSERIAL PRIMARY KEY,
  token            TEXT NOT NULL UNIQUE,
  telegram_user_id BIGINT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes')
);

-- Enable RLS (rows only accessible via SECURITY DEFINER functions or service role)
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_tokens ENABLE ROW LEVEL SECURITY;

-- ── RPC: validate token on page load ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION validate_signup_token(p_token TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result TEXT;
BEGIN
  SELECT CASE
    WHEN expires_at <= NOW() THEN 'expired'
    ELSE                          'valid'
  END INTO v_result
  FROM link_tokens WHERE token = p_token;
  RETURN COALESCE(v_result, 'not_found');
END;
$$;

GRANT EXECUTE ON FUNCTION validate_signup_token(TEXT) TO anon;

-- ── RPC: called from the signup page with the anon key ────────────────────────

CREATE OR REPLACE FUNCTION complete_signup(p_token TEXT, p_first_name TEXT, p_last_name TEXT, p_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid BIGINT;
BEGIN
  SELECT telegram_user_id INTO v_uid
  FROM link_tokens
  WHERE token = p_token AND expires_at > NOW();

  IF v_uid IS NULL THEN RETURN 'invalid_token'; END IF;

  DELETE FROM link_tokens WHERE token = p_token;
  UPDATE users SET status = 'active', first_name = p_first_name, last_name = p_last_name, email = p_email
  WHERE telegram_user_id = v_uid;

  RETURN 'ok';
END;
$$;

GRANT EXECUTE ON FUNCTION complete_signup(TEXT, TEXT, TEXT, TEXT) TO anon;

-- ─────────────────────────────────────────────────────────────
-- MIGRATION: run these if you already have the tables created
-- Replace YOUR_TELEGRAM_USER_ID with your actual Telegram user ID
-- (check bot logs or message @userinfobot to find it)
-- ─────────────────────────────────────────────────────────────
--
-- ALTER TABLE sets     ADD COLUMN telegram_user_id BIGINT;
-- ALTER TABLE sessions ADD COLUMN telegram_user_id BIGINT;
-- ALTER TABLE cycles   ADD COLUMN telegram_user_id BIGINT;
-- ALTER TABLE profile  ADD COLUMN telegram_user_id BIGINT;
--
-- UPDATE sets     SET telegram_user_id = YOUR_TELEGRAM_USER_ID;
-- UPDATE sessions SET telegram_user_id = YOUR_TELEGRAM_USER_ID;
-- UPDATE cycles   SET telegram_user_id = YOUR_TELEGRAM_USER_ID;
-- UPDATE profile  SET telegram_user_id = YOUR_TELEGRAM_USER_ID;
--
-- ALTER TABLE sets     ALTER COLUMN telegram_user_id SET NOT NULL;
-- ALTER TABLE sessions ALTER COLUMN telegram_user_id SET NOT NULL;
-- ALTER TABLE cycles   ALTER COLUMN telegram_user_id SET NOT NULL;
-- ALTER TABLE profile  ALTER COLUMN telegram_user_id SET NOT NULL;
--
-- CREATE INDEX idx_sets_user_id     ON sets(telegram_user_id);
-- CREATE INDEX idx_sessions_user_id ON sessions(telegram_user_id);
-- CREATE INDEX idx_cycles_user_id   ON cycles(telegram_user_id);
-- CREATE INDEX idx_profile_user_id  ON profile(telegram_user_id);
--
-- -- Fix profile unique constraint (was just on key, now scoped per user)
-- ALTER TABLE profile DROP CONSTRAINT IF EXISTS profile_key_key;
-- ALTER TABLE profile ADD CONSTRAINT profile_user_key_unique UNIQUE (telegram_user_id, key);
