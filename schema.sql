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
