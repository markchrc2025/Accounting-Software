-- ════════════════════════════════════════════════════════════════════════════
-- Sign-in lockout columns + credentials grants (M0.4).
-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS AS THE DATABASE OWNER (pgAdmin / psql as the owner role) BEFORE the
-- API redeploys.
--
-- Why it is needed: `credentials` was created at API boot by raw DDL, which
-- cannot work when the API connects as `sentire_books_app` (only USAGE on
-- schema public). Those failures were swallowed at boot. This delta moves the
-- table under owner control, adds the lockout columns, and grants the API role
-- the DML it needs.
--
-- Safe if the delta is missed: the API detects the absent columns at boot, logs
-- a loud error, and falls back to in-memory-only throttling. Sign-in keeps
-- working either way — but the durable lockout will not, so run this.
--
-- Idempotent and additive: safe to re-run.

CREATE TABLE IF NOT EXISTS credentials (
  email          text PRIMARY KEY,
  password_hash  text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE credentials
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until    timestamptz;

GRANT SELECT, INSERT, UPDATE, DELETE ON credentials TO sentire_books_app;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: lockout_columns = 2, and app_can_read / app_can_write = true.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'credentials'
       AND column_name IN ('failed_attempts', 'locked_until'))          AS lockout_columns,
  has_table_privilege('sentire_books_app', 'credentials', 'SELECT')     AS app_can_read,
  has_table_privilege('sentire_books_app', 'credentials', 'UPDATE')     AS app_can_write;
