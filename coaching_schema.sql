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

-- Permissive policies: authenticated users may only see/modify their own rows.
-- The service key is exempt from all RLS checks.

DROP POLICY IF EXISTS program_state_authenticated      ON program_state;
DROP POLICY IF EXISTS program_updates_authenticated    ON program_updates;
DROP POLICY IF EXISTS program_change_log_authenticated ON program_change_log;

CREATE POLICY program_state_authenticated
    ON program_state
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY program_updates_authenticated
    ON program_updates
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY program_change_log_authenticated
    ON program_change_log
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
