-- ══════════════════════════════════════════════════════════════════
-- Avenra web app migrations — run in Supabase SQL editor
-- ══════════════════════════════════════════════════════════════════

-- 1. Mapping: Supabase Auth user ↔ Telegram user ID
CREATE TABLE IF NOT EXISTS user_auth (
  auth_user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_user_id BIGINT  NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (auth_user_id)
);

ALTER TABLE user_auth ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_auth: owner can read"
  ON user_auth FOR SELECT
  USING (auth_user_id = auth.uid());

-- 2. RLS on sets (service role bypasses this; web app uses auth.uid() path)
ALTER TABLE sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sets: owner can read"
  ON sets FOR SELECT
  USING (
    telegram_user_id IN (
      SELECT telegram_user_id FROM user_auth WHERE auth_user_id = auth.uid()
    )
  );

-- 3. RLS on sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions: owner can read"
  ON sessions FOR SELECT
  USING (
    telegram_user_id IN (
      SELECT telegram_user_id FROM user_auth WHERE auth_user_id = auth.uid()
    )
  );

-- 4. RLS on cycles
ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;

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
