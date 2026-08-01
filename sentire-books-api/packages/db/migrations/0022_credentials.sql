-- ════════════════════════════════════════════════════════════════════════════
-- Local sign-in credentials — brought into the versioned migration set (M0.4).
-- ════════════════════════════════════════════════════════════════════════════
-- This table used to be created at API boot by `ensureAuthTables()` via raw DDL.
-- That could never work in a correct deployment: the API connects as
-- `sentire_books_app`, which has only USAGE on schema public, so CREATE TABLE
-- failed with "permission denied for schema public" and ALTER TABLE with "must
-- be owner of table credentials" — errors boot() swallowed. Migrations run as
-- the owner, so this is the right home for it.
--
-- Deliberately NOT org-scoped and NOT under RLS: credentials are keyed by EMAIL
-- (the identity, not a workspace), because one email may belong to several
-- workspaces and must have exactly one password. It is read during sign-in,
-- before any workspace is chosen, so there is no org context to scope by.
--
-- CREATE IF NOT EXISTS keeps this safe on databases where the runtime DDL
-- already created the table; the column definitions match what it produced.

CREATE TABLE IF NOT EXISTS credentials (
  email          text PRIMARY KEY,
  password_hash  text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Lockout state (M0.4): consecutive failures, and when the credential unlocks.
ALTER TABLE credentials
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until    timestamptz;

-- The API role needs DML only — never DDL. (The blanket grant in 0001_rls.sql
-- ran before this table existed, so it must be granted explicitly here.)
GRANT SELECT, INSERT, UPDATE, DELETE ON credentials TO sentire_books_app;
