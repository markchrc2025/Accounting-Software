-- ════════════════════════════════════════════════════════════════════════════
-- Sentire Books — one-time database setup.
-- Plain PostgreSQL (15+). Runs on ANY Postgres — Sliplane, a self-hosted
-- container, Supabase, etc. Run it as the database OWNER / superuser, e.g.
--   psql "postgres://owner:<PW>@<host>:<port>/sentire_books?sslmode=no-verify" -f db-setup.sql
-- (or paste it into your provider's SQL console). It creates roles, tables, RLS,
-- functions, and seed data, so it needs owner privileges.
--
-- BEFORE RUNNING, edit the two lines marked  -- EDIT  in the BOOTSTRAP section:
--   1) the sentire_books_app role password
--   2) your company name AND your company code (the tenant ID users type at login)
-- Run this file ONCE (re-running errors on already-existing types/tables).
--
-- AFTER you sign in once (which creates your auth user in your identity provider),
-- run the LAST block to make yourself an Admin of your org.
-- ════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── 0000_init.sql ─────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- Sentire Books — initial schema + ledger-integrity triggers
-- ════════════════════════════════════════════════════════════════════════════
-- This file is intentionally hand-written and self-contained so it can be applied
-- with `psql -f`. In the normal workflow, table DDL is produced by
-- `drizzle-kit generate` from schema.ts; the TRIGGER/FUNCTION blocks at the bottom
-- (which Drizzle cannot express) are the part you must keep by hand.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE account_type AS ENUM ('asset','liability','equity','income','expense');
CREATE TYPE entry_status AS ENUM ('draft','posted','reversed');
CREATE TYPE user_role   AS ENUM ('maker','verifier','approver','poster','admin');

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_users (
  id         uuid PRIMARY KEY,                          -- == auth provider uid
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email      text NOT NULL UNIQUE,
  full_name  text,
  role       user_role NOT NULL DEFAULT 'maker',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  type       account_type NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE document_counters (
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  seq        bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, period_key)
);

CREATE TABLE journal_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_no    text NOT NULL,
  entry_date  date NOT NULL,
  memo        text,
  status      entry_status NOT NULL DEFAULT 'draft',
  source_type text,
  source_id   uuid,
  reversal_of uuid REFERENCES journal_entries(id),
  created_by  uuid REFERENCES app_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  posted_at   timestamptz,
  UNIQUE (org_id, entry_no)              -- no duplicate / racing entry numbers
);
CREATE INDEX journal_entries_org_date_idx ON journal_entries (org_id, entry_date);

CREATE TABLE journal_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  account_id  uuid NOT NULL REFERENCES accounts(id),
  debit_cents  bigint NOT NULL DEFAULT 0,
  credit_cents bigint NOT NULL DEFAULT 0,
  contact_id  uuid,
  description text,
  CONSTRAINT debit_nonneg      CHECK (debit_cents  >= 0),
  CONSTRAINT credit_nonneg     CHECK (credit_cents >= 0),
  CONSTRAINT one_side_only     CHECK (debit_cents = 0 OR credit_cents = 0),
  CONSTRAINT at_least_one_side CHECK (debit_cents > 0 OR credit_cents > 0),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX journal_lines_entry_idx   ON journal_lines (entry_id);
CREATE INDEX journal_lines_account_idx ON journal_lines (account_id);

-- ════════════════════════════════════════════════════════════════════════════
-- INVARIANT 1 — every POSTED entry must be balanced (Σdebit = Σcredit) and > 0.
-- Enforced by a DEFERRABLE constraint trigger so multi-line inserts are checked
-- once, at COMMIT, not after each row. Drafts may be unbalanced (work-in-progress).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION assert_entry_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_entry_id uuid := COALESCE(NEW.entry_id, OLD.entry_id);
  v_status   entry_status;
  v_debit    bigint;
  v_credit   bigint;
BEGIN
  SELECT status INTO v_status FROM journal_entries WHERE id = v_entry_id;
  IF v_status IS NULL THEN RETURN NULL; END IF;          -- entry deleted in txn
  IF v_status <> 'posted' THEN RETURN NULL; END IF;      -- drafts not enforced

  SELECT COALESCE(SUM(debit_cents),0), COALESCE(SUM(credit_cents),0)
    INTO v_debit, v_credit
    FROM journal_lines WHERE entry_id = v_entry_id;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'Journal entry % is out of balance (debit=% credit=%)',
      v_entry_id, v_debit, v_credit USING ERRCODE = 'check_violation';
  END IF;
  IF v_debit = 0 THEN
    RAISE EXCEPTION 'Journal entry % has a zero total', v_entry_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();

-- Re-check when an entry itself transitions to 'posted'.
CREATE OR REPLACE FUNCTION assert_entry_balanced_on_post() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_debit bigint; v_credit bigint;
BEGIN
  IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(debit_cents),0), COALESCE(SUM(credit_cents),0)
    INTO v_debit, v_credit FROM journal_lines WHERE entry_id = NEW.id;
  IF v_debit <> v_credit OR v_debit = 0 THEN
    RAISE EXCEPTION 'Cannot post entry %: lines unbalanced (debit=% credit=%)',
      NEW.id, v_debit, v_credit USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER trg_entry_balanced_on_post
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced_on_post();

-- ════════════════════════════════════════════════════════════════════════════
-- INVARIANT 2 — POSTED entries are append-only. They cannot be edited or deleted;
-- the only allowed change is status 'posted' -> 'reversed'. Corrections are made
-- by inserting a NEW reversing entry. This makes the audit trail tamper-evident.
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION prevent_posted_entry_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'Posted entry % cannot be deleted — create a reversing entry.',
        OLD.id USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    IF NEW.status = 'reversed'
       AND NEW.org_id = OLD.org_id AND NEW.entry_no = OLD.entry_no
       AND NEW.entry_date = OLD.entry_date
       AND NEW.memo IS NOT DISTINCT FROM OLD.memo THEN
      RETURN NEW;                                        -- allow post -> reversed
    END IF;
    RAISE EXCEPTION 'Posted entry % is immutable.', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_entry_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_entry_mutation();

CREATE OR REPLACE FUNCTION prevent_posted_line_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status entry_status;
BEGIN
  SELECT status INTO v_status FROM journal_entries
    WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'Lines of a posted entry cannot be added, changed, or removed.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- Fires on INSERT too: the posting flow inserts lines while the entry is still a
-- 'draft', then flips it to 'posted' last — so legitimate creation is allowed,
-- but tacking lines onto an already-posted entry is blocked.
CREATE TRIGGER trg_line_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_line_mutation();

-- ───────────────────────────── 0001_rls.sql ─────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- Row-Level Security — defense-in-depth multi-tenant isolation.
-- ════════════════════════════════════════════════════════════════════════════
-- The API authenticates the caller, looks up their org via get_user_context(),
-- then sets `app.current_org_id` for the transaction. Every policy below filters
-- rows to that org, so even a bug that forgets `WHERE org_id = …` cannot leak or
-- write across tenants.
--
-- Connection model:
--   • migrations + seed run as the table OWNER → exempt from RLS (we do NOT FORCE),
--     so bootstrapping organizations/users/accounts works.
--   • the API connects as the non-owner role `sentire_books_app` → subject to RLS.
-- Point the app's DATABASE_URL at sentire_books_app in production.

-- Reads `app.current_org_id`; NULL when unset → policies deny by default.
CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid
$$;

-- Bootstrap: resolve a user's org + role WITHOUT RLS (SECURITY DEFINER), so the
-- API can establish context before any org-scoped query runs.
CREATE OR REPLACE FUNCTION get_user_context(p_uid uuid)
RETURNS TABLE (org_id uuid, role user_role, email text, full_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT org_id, role, email, full_name FROM app_users WHERE id = p_uid
$$;
REVOKE ALL ON FUNCTION get_user_context(uuid) FROM public;

-- Application role (subject to RLS). Grant it to your login role in deployment:
--   GRANT sentire_books_app TO <login_role>;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sentire_books_app') THEN
    CREATE ROLE sentire_books_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO sentire_books_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sentire_books_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sentire_books_app;
GRANT EXECUTE ON FUNCTION current_org_id() TO sentire_books_app;
GRANT EXECUTE ON FUNCTION get_user_context(uuid) TO sentire_books_app;

-- ── Enable RLS + org-isolation policies ─────────────────────────────────────
ALTER TABLE organizations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines     ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON organizations
  USING (id = current_org_id());

CREATE POLICY org_isolation ON app_users
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

CREATE POLICY org_isolation ON accounts
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

CREATE POLICY org_isolation ON document_counters
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

CREATE POLICY org_isolation ON journal_entries
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- journal_lines inherit their org from the parent entry.
CREATE POLICY org_isolation ON journal_lines
  USING (EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.id = journal_lines.entry_id AND je.org_id = current_org_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.id = journal_lines.entry_id AND je.org_id = current_org_id()));

-- ───────────────────────────── 0002_reports.sql ─────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- Reporting views — trial balance & profit-and-loss source data.
-- ════════════════════════════════════════════════════════════════════════════
-- security_invoker = true so Row-Level Security on the base tables applies to the
-- querying role (the API's sentire_books_app + its org context). Requires PostgreSQL 15+.

-- One row per POSTED journal line, flattened with its entry + account metadata.
CREATE OR REPLACE VIEW v_account_postings
WITH (security_invoker = true) AS
SELECT
  je.org_id,
  je.id           AS entry_id,
  je.entry_date,
  a.id            AS account_id,
  a.code          AS account_code,
  a.name          AS account_name,
  a.type          AS account_type,
  jl.debit_cents,
  jl.credit_cents
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id
JOIN accounts        a  ON a.id  = jl.account_id
WHERE je.status = 'posted';

-- All-time trial balance per account (period reports filter v_account_postings
-- by entry_date in the API).
CREATE OR REPLACE VIEW v_trial_balance
WITH (security_invoker = true) AS
SELECT
  org_id,
  account_id,
  account_code,
  account_name,
  account_type,
  SUM(debit_cents)                      AS debit_cents,
  SUM(credit_cents)                     AS credit_cents,
  SUM(debit_cents) - SUM(credit_cents)  AS balance_cents
FROM v_account_postings
GROUP BY org_id, account_id, account_code, account_name, account_type;

GRANT SELECT ON v_account_postings, v_trial_balance TO sentire_books_app;

-- ───────────────────────────── 0003_contacts.sql ─────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- Contacts — vendors, customers, employees referenced by vouchers and JE lines.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TYPE contact_type AS ENUM ('vendor', 'customer', 'employee');

CREATE TABLE contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type       contact_type NOT NULL,
  name       text NOT NULL,
  tin        text,
  email      text,
  phone      text,
  address    text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_org_type_idx ON contacts (org_id, type);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON contacts
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO sentire_books_app;

-- ───────────────────────────── 0004_vouchers.sql ─────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- Vouchers — a header over an atomically-posted journal entry.
-- ════════════════════════════════════════════════════════════════════════════
-- A voucher and its journal entry are created in ONE transaction (see
-- apps/api/src/ledger/createVoucher.ts), so the legacy "voucher saved but JE
-- missing / orphaned" failure mode is impossible.

CREATE TYPE voucher_type   AS ENUM ('payment', 'receipt');
CREATE TYPE voucher_status AS ENUM ('draft', 'posted', 'void');

CREATE TABLE vouchers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  voucher_no       text NOT NULL,
  voucher_type     voucher_type NOT NULL,
  contact_id       uuid REFERENCES contacts(id),
  voucher_date     date NOT NULL,
  memo             text,
  status           voucher_status NOT NULL DEFAULT 'draft',
  total_cents      bigint NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES journal_entries(id),
  created_by       uuid REFERENCES app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  posted_at        timestamptz,
  UNIQUE (org_id, voucher_no)
);
CREATE INDEX vouchers_org_date_idx ON vouchers (org_id, voucher_date);

ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON vouchers
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON vouchers TO sentire_books_app;

-- ───────────────────────────── 0005_accounts_extend.sql ─────────────────────────────
-- Extend accounts for a real-world chart: hierarchy, subtype, description, normal
-- balance. Codes repeat across types in real charts, so the unique key is the
-- NAME; code stays a non-unique, indexed label.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS parent_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subtype        text,
  ADD COLUMN IF NOT EXISTS description    text,
  ADD COLUMN IF NOT EXISTS normal_balance text
    CONSTRAINT accounts_normal_balance_chk CHECK (normal_balance IN ('debit','credit'));

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_org_id_code_key;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_org_code_key;
ALTER TABLE accounts ADD  CONSTRAINT accounts_org_name_key UNIQUE (org_id, name);
CREATE INDEX IF NOT EXISTS accounts_org_code_idx   ON accounts (org_id, code);
CREATE INDEX IF NOT EXISTS accounts_org_parent_idx ON accounts (org_id, parent_id);

-- ───────────────────────────── 0006_org_code.sql ─────────────────────────────
-- Company code (tenant ID) for multi-tenant login. Entered at login and verified
-- against the signed-in user's org. Data isolation stays enforced by RLS.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS code text;
UPDATE organizations
   SET code = 'ORG' || upper(substr(replace(id::text, '-', ''), 1, 8))
 WHERE code IS NULL;
ALTER TABLE organizations ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_code_key ON organizations (upper(code));

DROP FUNCTION IF EXISTS get_user_context(uuid);
CREATE FUNCTION get_user_context(p_uid uuid)
RETURNS TABLE (org_id uuid, role user_role, email text, full_name text, org_code text, org_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.org_id, u.role, u.email, u.full_name, o.code, o.name
  FROM app_users u
  JOIN organizations o ON o.id = u.org_id
  WHERE u.id = p_uid
$$;
REVOKE ALL ON FUNCTION get_user_context(uuid) FROM public;
GRANT EXECUTE ON FUNCTION get_user_context(uuid) TO sentire_books_app;

-- ───────────────────────────── 0007_auth_text_ids.sql ─────────────────────────────
-- Auth provider user IDs are strings (Authenticize / Better Auth), not UUIDs.
-- Widen app_users.id + the created_by FKs to text and switch get_user_context to
-- a text uid. Organization ids stay uuid.
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_created_by_fkey;
ALTER TABLE vouchers        DROP CONSTRAINT IF EXISTS vouchers_created_by_fkey;
ALTER TABLE app_users       ALTER COLUMN id         TYPE text USING id::text;
ALTER TABLE journal_entries ALTER COLUMN created_by TYPE text USING created_by::text;
ALTER TABLE vouchers        ALTER COLUMN created_by TYPE text USING created_by::text;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_users(id);
ALTER TABLE vouchers
  ADD CONSTRAINT vouchers_created_by_fkey        FOREIGN KEY (created_by) REFERENCES app_users(id);

DROP FUNCTION IF EXISTS get_user_context(uuid);
DROP FUNCTION IF EXISTS get_user_context(text);
CREATE FUNCTION get_user_context(p_uid text)
RETURNS TABLE (org_id uuid, role user_role, email text, full_name text, org_code text, org_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.org_id, u.role, u.email, u.full_name, o.code, o.name
  FROM app_users u
  JOIN organizations o ON o.id = u.org_id
  WHERE u.id = p_uid
$$;
REVOKE ALL ON FUNCTION get_user_context(text) FROM public;
GRANT EXECUTE ON FUNCTION get_user_context(text) TO sentire_books_app;

-- ───────────────────────────── 0008_auth_by_email.sql ─────────────────────────────
-- Resolve users by verified EMAIL (Authenticize authenticates; Sentire owns its
-- users as an email allowlist). app_users.id becomes app-owned (defaulted), and
-- get_user_context looks up by email.
ALTER TABLE app_users ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_key ON app_users (lower(email));

DROP FUNCTION IF EXISTS get_user_context(uuid);
DROP FUNCTION IF EXISTS get_user_context(text);
CREATE FUNCTION get_user_context(p_email text)
RETURNS TABLE (user_id text, org_id uuid, role user_role, email text, full_name text, org_code text, org_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.id, u.org_id, u.role, u.email, u.full_name, o.code, o.name
  FROM app_users u
  JOIN organizations o ON o.id = u.org_id
  WHERE lower(u.email) = lower(p_email)
$$;
REVOKE ALL ON FUNCTION get_user_context(text) FROM public;
GRANT EXECUTE ON FUNCTION get_user_context(text) TO sentire_books_app;

-- ───────────────────────────── 0009_multi_workspace.sql ─────────────────────────────
-- One identity (email) may belong to MULTIPLE workspaces (a bookkeeper serving
-- several clients). Email is unique PER workspace; after login the app lists the
-- caller's workspaces and (if >1) shows a picker. Each request carries the chosen
-- org (x-org-id) and resolves to that specific membership.
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_email_key;
DROP INDEX IF EXISTS app_users_email_lower_key;
CREATE UNIQUE INDEX IF NOT EXISTS app_users_org_email_lower_key ON app_users (org_id, lower(email));

DROP FUNCTION IF EXISTS get_user_workspaces(text);
CREATE FUNCTION get_user_workspaces(p_email text)
RETURNS TABLE (user_id text, org_id uuid, role user_role, email text, full_name text, org_code text, org_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.id, u.org_id, u.role, u.email, u.full_name, o.code, o.name
  FROM app_users u
  JOIN organizations o ON o.id = u.org_id
  WHERE lower(u.email) = lower(p_email)
  ORDER BY o.name
$$;
REVOKE ALL ON FUNCTION get_user_workspaces(text) FROM public;
GRANT EXECUTE ON FUNCTION get_user_workspaces(text) TO sentire_books_app;

DROP FUNCTION IF EXISTS get_user_context(text);
DROP FUNCTION IF EXISTS get_user_context(text, uuid);
CREATE FUNCTION get_user_context(p_email text, p_org_id uuid)
RETURNS TABLE (user_id text, org_id uuid, role user_role, email text, full_name text, org_code text, org_name text)
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT u.id, u.org_id, u.role, u.email, u.full_name, o.code, o.name
  FROM app_users u
  JOIN organizations o ON o.id = u.org_id
  WHERE lower(u.email) = lower(p_email) AND u.org_id = p_org_id
$$;
REVOKE ALL ON FUNCTION get_user_context(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION get_user_context(text, uuid) TO sentire_books_app;

-- ───────────────────────────── 0010_contacts_extend.sql ─────────────────────────────
-- Full portal contact model: rich multi-category types (canonical enum stays
-- derived), hierarchy, AR/AP refs, terms/credit (centavos), structured
-- addresses, banks, contact persons, notes; server-assigned CNT numbers.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS contact_no            text,
  ADD COLUMN IF NOT EXISTS display_name          text,
  ADD COLUMN IF NOT EXISTS parent_id             uuid REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS types                 text[],
  ADD COLUMN IF NOT EXISTS cost_center           text,
  ADD COLUMN IF NOT EXISTS category              text,
  ADD COLUMN IF NOT EXISTS branch                text,
  ADD COLUMN IF NOT EXISTS department            text,
  ADD COLUMN IF NOT EXISTS ar_account_code       text,
  ADD COLUMN IF NOT EXISTS ap_account_code       text,
  ADD COLUMN IF NOT EXISTS payment_terms         text,
  ADD COLUMN IF NOT EXISTS currency              text,
  ADD COLUMN IF NOT EXISTS credit_limit_cents    bigint,
  ADD COLUMN IF NOT EXISTS opening_balance_cents bigint,
  ADD COLUMN IF NOT EXISTS tax_ref               text,
  ADD COLUMN IF NOT EXISTS mobile                text,
  ADD COLUMN IF NOT EXISTS website               text,
  ADD COLUMN IF NOT EXISTS billing_address       jsonb,
  ADD COLUMN IF NOT EXISTS shipping_address      jsonb,
  ADD COLUMN IF NOT EXISTS banks                 jsonb,
  ADD COLUMN IF NOT EXISTS contact_persons       jsonb,
  ADD COLUMN IF NOT EXISTS notes                 text,
  ADD COLUMN IF NOT EXISTS internal_remarks      text,
  ADD COLUMN IF NOT EXISTS needs_completion      boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_no_key
  ON contacts (org_id, contact_no) WHERE contact_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_org_parent_idx ON contacts (org_id, parent_id);

-- ───────────────────────────── 0011_journal_workflow.sql ─────────────────────────────
-- Maker-checker workflow states (pre-posted states are mutable; 'posted' keeps
-- its append-only, must-balance semantics), entry classification + reference +
-- accrual auto-reversal link, and the reversed-entries report fix.
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'pending_approval';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'for_clearing';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'cleared';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'for_posting';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'voided';

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS entry_type          text NOT NULL DEFAULT 'Manual',
  ADD COLUMN IF NOT EXISTS reference           text,
  ADD COLUMN IF NOT EXISTS accrual_reversal_of uuid REFERENCES journal_entries(id);

-- Reversed entries' postings still happened (the reversal offsets them) — count
-- both, or reports show a net negative after every reversal.
CREATE OR REPLACE VIEW v_account_postings
WITH (security_invoker = true) AS
SELECT
  je.org_id,
  je.id           AS entry_id,
  je.entry_date,
  a.id            AS account_id,
  a.code          AS account_code,
  a.name          AS account_name,
  a.type          AS account_type,
  jl.debit_cents,
  jl.credit_cents
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id
JOIN accounts        a  ON a.id  = jl.account_id
WHERE je.status IN ('posted', 'reversed');

-- ───────────────────────────── 0012_vouchers_workflow.sql ─────────────────────────────
-- Voucher approval workflow + persisted voucher lines: the JE posts at
-- 'approved' from the voucher's own lines; 'void' reverses it.
ALTER TYPE voucher_type ADD VALUE IF NOT EXISTS 'payroll';
ALTER TYPE voucher_type ADD VALUE IF NOT EXISTS 'final_pay';
ALTER TYPE voucher_type ADD VALUE IF NOT EXISTS 'loan';
ALTER TYPE voucher_type ADD VALUE IF NOT EXISTS 'check';

ALTER TYPE voucher_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE voucher_status ADD VALUE IF NOT EXISTS 'for_verification';
ALTER TYPE voucher_status ADD VALUE IF NOT EXISTS 'verified';
ALTER TYPE voucher_status ADD VALUE IF NOT EXISTS 'for_approval';
ALTER TYPE voucher_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE voucher_status ADD VALUE IF NOT EXISTS 'paid';
ALTER TYPE voucher_status ADD VALUE IF NOT EXISTS 'rejected';

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS purpose_category        text,
  ADD COLUMN IF NOT EXISTS payment_from_account_id uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS notes                   text,
  ADD COLUMN IF NOT EXISTS meta                    jsonb;

CREATE TABLE IF NOT EXISTS voucher_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id  uuid NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  line_no     integer NOT NULL,
  account_id  uuid NOT NULL REFERENCES accounts(id),
  description text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  meta        jsonb,
  UNIQUE (voucher_id, line_no)
);
CREATE INDEX IF NOT EXISTS voucher_lines_voucher_idx ON voucher_lines (voucher_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON voucher_lines TO sentire_books_app;
ALTER TABLE voucher_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voucher_lines_org ON voucher_lines;
CREATE POLICY voucher_lines_org ON voucher_lines
  USING (EXISTS (
    SELECT 1 FROM vouchers v
    WHERE v.id = voucher_lines.voucher_id AND v.org_id = current_org_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM vouchers v
    WHERE v.id = voucher_lines.voucher_id AND v.org_id = current_org_id()
  ));

-- ───────────────────────────── 0013_disbursement_checks.sql ─────────────────────────────
-- Checkbook master, check registry, disbursement reports, org settings, and
-- the voucher 'for_disbursement' round-trip.
-- check PDFs and the disbursement signatories read.

CREATE TABLE IF NOT EXISTS org_settings (
  org_id           uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  profile          jsonb,
  approval_routing jsonb,
  doc_numbering    jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON org_settings;
CREATE POLICY org_isolation ON org_settings
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON org_settings TO sentire_books_app;

CREATE TABLE IF NOT EXISTS checkbooks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_code         text NOT NULL,
  checkbook_type    text NOT NULL DEFAULT 'Loose',
  starting_number   text NOT NULL,
  ending_number     text,
  checks_count      integer,
  next_check_number text,
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_by        text REFERENCES app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkbooks_org_bank_idx ON checkbooks (org_id, bank_code);
ALTER TABLE checkbooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON checkbooks;
CREATE POLICY org_isolation ON checkbooks
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON checkbooks TO sentire_books_app;

CREATE TABLE IF NOT EXISTS check_registry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  check_no         text NOT NULL,             -- human id (CHK…)
  checkbook_id     uuid REFERENCES checkbooks(id),
  bank_code        text,
  check_number     text NOT NULL,             -- the printed series number
  check_date       date,
  issue_date       date,
  payee_name       text,
  amount_cents     bigint NOT NULL DEFAULT 0,
  net_amount_cents bigint,
  status           text NOT NULL DEFAULT 'Issued',  -- Issued|Cleared|Voided|Stopped|Stale
  reference_type   text,
  reference_id     text,
  voucher_id       uuid REFERENCES vouchers(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  is_part_of_multiple boolean NOT NULL DEFAULT false,
  line_no          integer,
  void_reason      text,
  cleared_date     date,
  voided_date      date,
  stopped_date     date,
  stale_date       date,
  notes            text,
  meta             jsonb,
  created_by       text REFERENCES app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS check_registry_org_status_idx ON check_registry (org_id, status);
CREATE INDEX IF NOT EXISTS check_registry_org_bank_idx ON check_registry (org_id, bank_code, check_number);
ALTER TABLE check_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON check_registry;
CREATE POLICY org_isolation ON check_registry
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON check_registry TO sentire_books_app;

CREATE TABLE IF NOT EXISTS disbursement_reports (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_no                 text NOT NULL,
  report_date               date NOT NULL,
  bank_code                 text,
  total_cents               bigint NOT NULL DEFAULT 0,
  expected_collection_cents bigint NOT NULL DEFAULT 0,
  status                    text NOT NULL DEFAULT 'Pending',
  notes                     text,
  bank_balances             jsonb,
  lines                     jsonb,             -- snapshot: voucher refs + amounts
  meta                      jsonb,
  created_by                text REFERENCES app_users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, report_no)
);
CREATE INDEX IF NOT EXISTS disbursement_reports_org_date_idx ON disbursement_reports (org_id, report_date);
ALTER TABLE disbursement_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON disbursement_reports;
CREATE POLICY org_isolation ON disbursement_reports
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON disbursement_reports TO sentire_books_app;

-- Vouchers travel through disbursement: queued vouchers flip to
-- 'for_disbursement' (remembering where they came from) and revert when pulled.
ALTER TYPE voucher_status ADD VALUE IF NOT EXISTS 'for_disbursement';
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS pre_disbursement_status text,
  ADD COLUMN IF NOT EXISTS disbursement_ref        text;

-- ───────────────────────────── 0014_tax_bank.sql ─────────────────────────────
-- Tax subsystem (rates/groups/purpose categories) + bank management (daily
-- balances, transactions, reconciliations). Org-scoped RLS + grants.

CREATE TABLE IF NOT EXISTS tax_rates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  rate                  numeric(9,4) NOT NULL DEFAULT 0,
  tracking_type         text NOT NULL DEFAULT 'single',   -- single | separate
  tax_account_single    text,                             -- account codes
  tax_account_sales     text,
  tax_account_purchases text,
  is_active             boolean NOT NULL DEFAULT true,
  created_by            text REFERENCES app_users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS tax_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  rate_names text[] NOT NULL DEFAULT '{}',
  is_active  boolean NOT NULL DEFAULT true,
  created_by text REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS purpose_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS daily_bank_balances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_code       text NOT NULL,
  balance_date    date NOT NULL,
  beginning_cents bigint NOT NULL DEFAULT 0,
  ending_cents    bigint NOT NULL DEFAULT 0,
  notes           text,
  created_by      text REFERENCES app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_bank_balances_org_bank_date_idx
  ON daily_bank_balances (org_id, bank_code, balance_date DESC);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_code    text NOT NULL,
  tx_date      date NOT NULL,
  description  text,
  reference    text,
  debit_cents  bigint NOT NULL DEFAULT 0,
  credit_cents bigint NOT NULL DEFAULT 0,
  tx_type      text,
  status       text,
  source       text NOT NULL DEFAULT 'Manual',
  created_by   text REFERENCES app_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_transactions_org_bank_date_idx
  ON bank_transactions (org_id, bank_code, tx_date DESC);

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recon_no        text NOT NULL,
  bank_code       text NOT NULL,
  beginning_cents bigint NOT NULL DEFAULT 0,
  ending_cents    bigint NOT NULL DEFAULT 0,
  period_ending   date,
  cleared_count   integer NOT NULL DEFAULT 0,
  meta            jsonb,
  created_by      text REFERENCES app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, recon_no)
);

-- Org-scoped RLS + app-role grants for every new table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_rates','tax_groups','purpose_categories',
                           'daily_bank_balances','bank_transactions','bank_reconciliations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sentire_books_app', t);
  END LOOP;
END $$;

-- ───────────────────────────── 0015_billing_ar.sql ─────────────────────────────
CREATE TABLE IF NOT EXISTS billing_statements (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bs_no                     text NOT NULL,
  contact_id                uuid REFERENCES contacts(id),
  contact_name              text NOT NULL,
  billing_date              date NOT NULL,
  due_date                  date,
  credit_term               integer NOT NULL DEFAULT 30,
  period_start              date,
  period_end                date,
  description               text,
  gross_cents               bigint NOT NULL DEFAULT 0,
  tax_group_name            text NOT NULL DEFAULT 'VAT',
  total_vat_inclusive_cents bigint NOT NULL DEFAULT 0,
  net_due_cents             bigint NOT NULL DEFAULT 0,
  applied_cents             bigint NOT NULL DEFAULT 0,
  balance_cents             bigint GENERATED ALWAYS AS (net_due_cents - applied_cents) STORED,
  income_account            text,
  lines                     jsonb,
  notes                     text,
  status                    text NOT NULL DEFAULT 'Draft',
  reviewed_by               text,
  approved_by               text,
  reject_reason             text,
  created_by                text REFERENCES app_users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, bs_no)
);
CREATE INDEX IF NOT EXISTS billing_statements_org_date_idx
  ON billing_statements (org_id, billing_date DESC);

CREATE TABLE IF NOT EXISTS service_invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  si_no                text NOT NULL,
  contact_id           uuid REFERENCES contacts(id),
  contact_name         text NOT NULL,
  si_date              date NOT NULL,
  due_date             date,
  amount_cents         bigint NOT NULL DEFAULT 0,
  tax_type             text NOT NULL DEFAULT 'N/A',
  ewt_rate             numeric(9,4) NOT NULL DEFAULT 0,
  income_account_code  text,
  billing_statement_id text,        -- soft link: BS number or id, as the portal stores it
  applied_cents        bigint NOT NULL DEFAULT 0,
  balance_cents        bigint GENERATED ALWAYS AS (amount_cents - applied_cents) STORED,
  notes                text,
  status               text NOT NULL DEFAULT 'Draft',
  reviewed_by          text,
  approved_by          text,
  reject_reason        text,
  created_by           text REFERENCES app_users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, si_no)
);
CREATE INDEX IF NOT EXISTS service_invoices_org_date_idx
  ON service_invoices (org_id, si_date DESC);

CREATE TABLE IF NOT EXISTS collections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  collection_no         text NOT NULL,
  contact_id            uuid REFERENCES contacts(id),
  contact_name          text NOT NULL,
  collection_date       date NOT NULL,
  amount_received_cents bigint NOT NULL DEFAULT 0,
  applied_cents         bigint NOT NULL DEFAULT 0,
  unapplied_cents       bigint GENERATED ALWAYS AS (amount_received_cents - applied_cents) STORED,
  method                text NOT NULL DEFAULT 'Cash',
  reference_no          text,
  billing_statement_id  text,       -- soft links, same convention as service_invoices
  si_id                 text,
  notes                 text,
  status                text NOT NULL DEFAULT 'Unposted',
  posted_by             text,
  posted_at             timestamptz,
  created_by            text REFERENCES app_users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, collection_no)
);
CREATE INDEX IF NOT EXISTS collections_org_date_idx
  ON collections (org_id, collection_date DESC);

CREATE TABLE IF NOT EXISTS payment_schedules (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_no                  text NOT NULL,
  title                        text NOT NULL,
  contact_id                   uuid REFERENCES contacts(id),
  contact_name                 text,
  category                     text,
  frequency                    text NOT NULL DEFAULT 'Monthly',
  amount_cents                 bigint NOT NULL DEFAULT 0,
  due_date                     date,
  start_date                   date,
  end_date                     date,
  due_day                      integer NOT NULL DEFAULT 0,
  status                       text NOT NULL DEFAULT 'Active',
  notes                        text,
  default_expense_account_code text,
  default_tax_rate_id          text, -- taxRates.id OR taxGroups.id (the portal treats them as a union)
  payment_method               text,
  pm_config                    jsonb, -- bank-transfer / auto-debit / check-queue details (UI-owned)
  created_by                   text REFERENCES app_users(id),
  created_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, schedule_no)
);

CREATE TABLE IF NOT EXISTS schedule_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schedule_id       uuid REFERENCES payment_schedules(id) ON DELETE SET NULL,
  schedule_title    text,
  due_date          date,
  pay_date          date NOT NULL,
  amount_cents      bigint NOT NULL DEFAULT 0,
  method            text,
  bank              text,
  check_id          text,
  check_number      text,
  check_register_id text,
  voucher_no        text,
  voucher_doc_id    uuid,             -- soft link to vouchers.id (no FK: drafts are deletable)
  notes             text,
  created_by        text REFERENCES app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_payments_org_schedule_idx
  ON schedule_payments (org_id, schedule_id);

-- Org-scoped RLS + app-role grants for every new table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_statements','service_invoices','collections',
                           'payment_schedules','schedule_payments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sentire_books_app', t);
  END LOOP;
END $$;

-- ───────────────────────────── 0016_loans_assets_projections.sql ─────────────────────────────
CREATE TABLE IF NOT EXISTS loans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               text NOT NULL,               -- lender
  loan_type          text NOT NULL DEFAULT 'Term Loan',
  disbursement_date  date,                        -- UI: "First Payment Date" (schedule anchor)
  proceeds_date      date,
  term_months        integer NOT NULL DEFAULT 60,
  annual_rate        numeric(9,4) NOT NULL DEFAULT 0,
  principal_cents    bigint NOT NULL DEFAULT 0,
  interest_method    text NOT NULL DEFAULT 'Reducing Balance',
  processing_fee_cents bigint NOT NULL DEFAULT 0,
  status             text NOT NULL DEFAULT 'Active',   -- Active | Disposed
  payment_frequency  text NOT NULL DEFAULT 'Monthly',  -- Monthly | Semi-Monthly
  pay_day_mode       text NOT NULL DEFAULT 'Fixed',    -- Fixed | Variable per Month | Every N Days
  pay_day1           integer,
  pay_day2           integer,
  pay_days_per_month jsonb,                       -- { 'YYYY-MM': { d1, d2 } }
  interval_days      integer NOT NULL DEFAULT 15,
  payment_method     text,
  pm_config          jsonb,                       -- checkbook/check-queue/BT/ADA details (UI-owned)
  created_by         text REFERENCES app_users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  loan_id           uuid REFERENCES loans(id) ON DELETE SET NULL,
  loan_name         text,
  pay_date          date NOT NULL,
  interest_cents    bigint NOT NULL DEFAULT 0,
  principal_cents   bigint NOT NULL DEFAULT 0,
  penalty_cents     bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  method            text,
  reference_no      text,
  bank              text,
  voucher_no        text,        -- consumed LV's human number
  voucher_doc_id    uuid,        -- consumed LV's row id (soft link)
  check_voucher_no  text,        -- linked CV's human number
  notes             text,
  allocations       jsonb,       -- [{ period, interest, principal, penalty }] in pesos (UI-owned)
  created_by        text REFERENCES app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loan_payments_org_loan_idx ON loan_payments (org_id, loan_id);

CREATE TABLE IF NOT EXISTS asset_types (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type_no               text,                     -- FAT-### (client-assigned, display only)
  name                  text NOT NULL,
  depreciation_method   text NOT NULL DEFAULT 'Straight Line',
  useful_life_months    integer,
  fixed_asset_account   text,
  accum_deprec_account  text,
  deprec_expense_account text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_no                        text NOT NULL,  -- FA-### (client-assigned max+1, unique per org)
  name                            text NOT NULL,
  asset_type                      text,           -- asset_types.name (loose, as the portal keys it)
  purchase_date                   date,
  deprec_start_date               date,
  cost_cents                      bigint NOT NULL DEFAULT 0,
  residual_cents                  bigint NOT NULL DEFAULT 0,
  useful_life_months              integer NOT NULL DEFAULT 0,
  depreciation_method             text NOT NULL DEFAULT 'Straight Line',
  computation_type                text NOT NULL DEFAULT 'Non Pro Rata',
  fixed_asset_account             text,
  accum_deprec_account            text,
  deprec_expense_account          text,
  status                          text NOT NULL DEFAULT 'Active',  -- Active | Disposed
  disposal_date                   date,
  notes                           text,
  is_installment                  boolean NOT NULL DEFAULT false,
  installment_principal_cents     bigint NOT NULL DEFAULT 0,
  installment_start_date          date,
  installment_term_months         integer NOT NULL DEFAULT 0,
  installment_annual_rate         numeric(9,4) NOT NULL DEFAULT 0,
  installment_method              text NOT NULL DEFAULT 'Reducing Balance',
  installment_payable_account     text,
  installment_amortization_account text,
  payment_method                  text,
  pm_config                       jsonb,          -- pmChecks / ADA / BT / auto-voucher (UI-owned)
  created_by                      text REFERENCES app_users(id),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, asset_no)
);

CREATE TABLE IF NOT EXISTS asset_installment_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id          uuid REFERENCES fixed_assets(id) ON DELETE SET NULL,
  asset_name        text,
  period            integer NOT NULL,             -- 1-based installment period
  label             text,                         -- 'Mar-2026'
  pay_date          date NOT NULL,
  principal_cents   bigint NOT NULL DEFAULT 0,
  interest_cents    bigint NOT NULL DEFAULT 0,
  total_cents       bigint NOT NULL DEFAULT 0,
  method            text,
  bank              text,
  check_id          text,
  check_number      text,
  check_register_id text,
  voucher_no        text,
  voucher_doc_id    uuid,
  notes             text,
  created_by        text REFERENCES app_users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_installment_payments_org_asset_idx
  ON asset_installment_payments (org_id, asset_id);

CREATE TABLE IF NOT EXISTS asset_depr_postings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period           text NOT NULL,                 -- 'YYYY-MM'; one posting per month
  journal_entry_id uuid,                          -- the depreciation JE (soft link)
  total_cents      bigint NOT NULL DEFAULT 0,
  asset_count      integer NOT NULL DEFAULT 0,
  created_by       text REFERENCES app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, period)
);

CREATE TABLE IF NOT EXISTS weekly_projections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proj_no         text NOT NULL,                  -- WP{YYYYMM}-#### (server-assigned)
  week_coverage   text,
  start_date      date,
  end_date        date,
  status          text NOT NULL DEFAULT 'Draft',
  total_out_cents bigint NOT NULL DEFAULT 0,      -- Σ lines[].amount, denormalized like the portal
  total_in_cents  bigint NOT NULL DEFAULT 0,      -- Σ inflowLines[].amount
  notes           text,
  lines           jsonb,                          -- disbursement lines (UI-owned, pesos)
  inflow_lines    jsonb,                          -- expected inflows (UI-owned, pesos)
  created_by      text REFERENCES app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, proj_no)
);

CREATE TABLE IF NOT EXISTS credit_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_code               text,
  display_name            text NOT NULL,
  credit_limit_cents      bigint NOT NULL DEFAULT 0,
  interest_rate           numeric(9,4) NOT NULL DEFAULT 0,   -- % per month
  available_balance_cents bigint NOT NULL DEFAULT 0,
  as_of_date              date,
  notes                   text,
  created_by              text REFERENCES app_users(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Org-scoped RLS + app-role grants for every new table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['loans','loan_payments','asset_types','fixed_assets',
                           'asset_installment_payments','asset_depr_postings',
                           'weekly_projections','credit_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format('CREATE POLICY org_isolation ON %I USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO sentire_books_app', t);
  END LOOP;
END $$;

-- ───────────────────────────── 0017_settings_users.sql ─────────────────────────────
CREATE TABLE IF NOT EXISTS payment_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  days        integer NOT NULL DEFAULT 0,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
ALTER TABLE payment_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON payment_terms;
CREATE POLICY org_isolation ON payment_terms
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_terms TO sentire_books_app;

ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS module_policies jsonb;
ALTER TABLE app_users    ADD COLUMN IF NOT EXISTS profile         jsonb;

-- ════════════════════════════════════════════════════════════════════════════
-- BOOTSTRAP — app role login, your organization, and chart of accounts
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Give the RLS-bound app role a login. The API connects to the DB as this role.
ALTER ROLE sentire_books_app WITH LOGIN PASSWORD 'CHANGE_ME_app_password';        -- EDIT

-- 2) Your organization. Pick a short COMPANY CODE (tenant ID) your users type at
--    login — letters/digits, e.g. ACMEFOODS. Keep the id as-is (referenced below).
INSERT INTO organizations (id, name, code)
VALUES ('a0000000-0000-0000-0000-000000000001', 'Your Company Inc.', 'YOURCODE') -- EDIT name + code
ON CONFLICT (id) DO NOTHING;

-- 3) Chart of accounts: import it IN THE APP.
--    New workspaces start with an empty chart. After you sign in, go to the
--    Accounts page and upload your Chart-of-Accounts .xlsx — the app parses it
--    (accounts + parent hierarchy) and inserts it. Nothing to hardcode here.
--    (Prefer SQL? setup/seed-chart-of-accounts.sql still exists as an optional
--    generated seed you can run instead.)

-- ════════════════════════════════════════════════════════════════════════════
-- MAKE YOURSELF ADMIN — add your email to THIS workspace's allowlist. Sentire
-- admits users by their VERIFIED email, so you only need the email here (the id is
-- generated). Do this once for the first admin; after that, invite users from the
-- app's Users page. Then sign in with this same email via Authenticize.
--
-- The same email may be added to several workspaces (one row per workspace, each
-- with its own role) — after login the app lets you pick which to enter.
-- ════════════════════════════════════════════════════════════════════════════
-- INSERT INTO app_users (org_id, email, full_name, role)
-- VALUES (
--   'a0000000-0000-0000-0000-000000000001',   -- the org id from the bootstrap above
--   'you@example.com',                        -- EDIT: your email (must match your Authenticize login)
--   'Your Name',                              -- EDIT: your name
--   'admin'
-- )
-- ON CONFLICT (org_id, lower(email)) DO NOTHING;
