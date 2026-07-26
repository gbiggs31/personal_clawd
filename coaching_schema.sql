-- ============================================================
-- Avenra coaching state tables
-- Run once against your Supabase project.
-- ============================================================

-- ── program_state ────────────────────────────────────────────────────────────
-- One row per user: the fully assembled, canonical coaching state.

CREATE TABLE IF NOT EXISTS program_state (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id    BIGINT      NOT NULL UNIQUE,
    state_json          JSONB       NOT NULL DEFAULT '{}',
    version             INT         NOT NULL DEFAULT 1,
    updated_at          TIMESTAMPTZ          DEFAULT NOW(),
    created_at          TIMESTAMPTZ          DEFAULT NOW()
);

-- ── program_updates ──────────────────────────────────────────────────────────
-- Individual extracted coaching updates (patch-style, one per coaching change).

CREATE TABLE IF NOT EXISTS program_updates (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id            BIGINT      NOT NULL,

    -- Classification
    update_type                 TEXT        NOT NULL
                                    CHECK (update_type IN (
                                        'rule',
                                        'constraint',
                                        'exercise_order_change',
                                        'substitution',
                                        'progression_change',
                                        'volume_change',
                                        'effort_change',
                                        'priority_change'
                                    )),

    -- Lifecycle
    status                      TEXT        NOT NULL DEFAULT 'proposed'
                                    CHECK (status IN (
                                        'proposed',
                                        'applied',
                                        'rejected',
                                        'superseded',
                                        'inactive'
                                    )),

    -- Human-readable identity
    title                       TEXT        NOT NULL,
    description                 TEXT        NOT NULL,
    reason                      TEXT,

    -- Applicability scope
    applicability_type          TEXT        NOT NULL DEFAULT 'durable'
                                    CHECK (applicability_type IN (
                                        'durable',
                                        'temporary',
                                        'phase_based'
                                    )),
    start_at                    DATE,
    end_at                      DATE,
    applies_while               TEXT,
    applies_to_programme_phase  TEXT,

    -- Targeting
    workout_type                TEXT,
    exercise_name               TEXT,
    exercise_family             TEXT,

    -- Quality signal
    confidence                  FLOAT       NOT NULL DEFAULT 0,

    -- Deduplication / conflict resolution key
    rule_key                    TEXT,

    -- Rich metadata
    provenance_json             JSONB       NOT NULL DEFAULT '{}',
    extracted_payload           JSONB       NOT NULL DEFAULT '{}',

    -- Timestamps
    created_at                  TIMESTAMPTZ          DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ          DEFAULT NOW(),
    applied_at                  TIMESTAMPTZ,

    -- Supersession chain
    superseded_by               UUID        REFERENCES program_updates (id)
);

-- ── program_change_log ───────────────────────────────────────────────────────
-- Immutable audit trail; never update rows here.

CREATE TABLE IF NOT EXISTS program_change_log (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id    BIGINT      NOT NULL,
    source_update_id    UUID        REFERENCES program_updates (id),
    change_type         TEXT        NOT NULL,
    before_json         JSONB,
    after_json          JSONB,
    applied_by          TEXT        NOT NULL DEFAULT 'system',
    created_at          TIMESTAMPTZ          DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_program_updates_user_status
    ON program_updates (telegram_user_id, status);

CREATE INDEX IF NOT EXISTS idx_program_updates_user_rule_key
    ON program_updates (telegram_user_id, rule_key)
    WHERE rule_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_program_change_log_user
    ON program_change_log (telegram_user_id);

CREATE INDEX IF NOT EXISTS idx_program_change_log_source
    ON program_change_log (source_update_id);

-- ── Row-Level Security ───────────────────────────────────────────────────────
-- The service role key bypasses RLS entirely, so these policies are a
-- defence-in-depth measure for the authenticated (webapp) role.

ALTER TABLE program_state       ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_updates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_change_log  ENABLE ROW LEVEL SECURITY;

-- Deny-by-default for the authenticated role.
--
-- ⚠️ These three tables previously carried policies named
-- program_{state,updates,change_log}_authenticated declared as
-- `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. The comment above
-- them claimed "authenticated users may only see/modify their own rows", but
-- `USING (true)` does the opposite: it let ANY logged-in user read and write
-- EVERY user's program data straight from PostgREST with the browser-visible
-- anon key. Supabase's linter flags this as rls_policy_always_true.
--
-- Nothing needs that access. Every reader and writer of these tables uses the
-- service-role key, which bypasses RLS entirely: coaching_pipeline.py, bot.py,
-- and webapp/api/today-plan.js (via lib/auth.js serviceClient). No browser code
-- under webapp/src/ touches them. So RLS enabled with no policy is both correct
-- and strictly safer — the same pattern already used for profile, bug_reports,
-- consent_records and deletion_requests.

DROP POLICY IF EXISTS program_state_authenticated      ON program_state;
DROP POLICY IF EXISTS program_updates_authenticated    ON program_updates;
DROP POLICY IF EXISTS program_change_log_authenticated ON program_change_log;

-- If the browser ever needs to read these directly, add owner-scoped SELECT
-- policies rather than restoring the permissive ones. All three key on
-- telegram_user_id, so they follow the sets/sessions pattern exactly:
--
--   CREATE POLICY "program_state: owner can read"
--     ON program_state FOR SELECT
--     USING (
--       telegram_user_id IN (
--         SELECT telegram_user_id FROM user_auth WHERE auth_user_id = auth.uid()
--       )
--     );
--
-- Keep them SELECT-only. Writes belong to the pipeline, not the browser.

-- Verify afterwards: expect three rows, all with policy_count = 0.
--   SELECT c.relname, c.relrowsecurity,
--          (SELECT count(*) FROM pg_policies p
--            WHERE p.schemaname='public' AND p.tablename=c.relname) AS policy_count
--   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--   WHERE n.nspname='public'
--     AND c.relname IN ('program_state','program_updates','program_change_log');
