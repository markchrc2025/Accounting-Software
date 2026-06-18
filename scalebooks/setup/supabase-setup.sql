-- ════════════════════════════════════════════════════════════════════════════
-- ScaleBooks — one-time Supabase setup.
-- Paste this WHOLE file into the Supabase SQL Editor (SQL Editor → New query) and
-- Run. It runs as the postgres owner, so it can create roles, tables, RLS,
-- functions, and seed data.
--
-- BEFORE RUNNING, edit the two lines marked  -- EDIT  in the BOOTSTRAP section:
--   1) the scalebooks_app role password
--   2) your company name
-- Run this file ONCE (re-running errors on already-existing types/tables).
--
-- AFTER you enable Google sign-in and log in once, run the LAST block (it maps
-- your login to an Admin of your org).
-- ════════════════════════════════════════════════════════════════════════════

-- ───────────────────────────── 0000_init.sql ─────────────────────────────
-- ════════════════════════════════════════════════════════════════════════════
-- ScaleBooks — initial schema + ledger-integrity triggers
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
--   • the API connects as the non-owner role `scalebooks_app` → subject to RLS.
-- Point the app's DATABASE_URL at scalebooks_app in production.

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
--   GRANT scalebooks_app TO <login_role>;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scalebooks_app') THEN
    CREATE ROLE scalebooks_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO scalebooks_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scalebooks_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scalebooks_app;
GRANT EXECUTE ON FUNCTION current_org_id() TO scalebooks_app;
GRANT EXECUTE ON FUNCTION get_user_context(uuid) TO scalebooks_app;

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
-- querying role (the API's scalebooks_app + its org context). Requires PostgreSQL 15+.

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

GRANT SELECT ON v_account_postings, v_trial_balance TO scalebooks_app;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO scalebooks_app;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON vouchers TO scalebooks_app;

-- ════════════════════════════════════════════════════════════════════════════
-- BOOTSTRAP — app role login, your organization, and chart of accounts
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Give the RLS-bound app role a login. The API connects to the DB as this role.
ALTER ROLE scalebooks_app WITH LOGIN PASSWORD 'CHANGE_ME_app_password';        -- EDIT

-- 2) Your organization (keep this id — it is referenced below and by your admin row).
INSERT INTO organizations (id, name)
VALUES ('a0000000-0000-0000-0000-000000000001', 'Your Company Inc.')           -- EDIT name
ON CONFLICT (id) DO NOTHING;

-- 3) Standard Philippine chart of accounts for that organization.
INSERT INTO accounts (org_id, code, name, type) VALUES
  ('a0000000-0000-0000-0000-000000000001','1000','Cash on Hand','asset'),
  ('a0000000-0000-0000-0000-000000000001','1010','Cash in Bank','asset'),
  ('a0000000-0000-0000-0000-000000000001','1100','Accounts Receivable','asset'),
  ('a0000000-0000-0000-0000-000000000001','1200','Input VAT','asset'),
  ('a0000000-0000-0000-0000-000000000001','1300','Prepaid Expenses','asset'),
  ('a0000000-0000-0000-0000-000000000001','1500','Property, Plant & Equipment','asset'),
  ('a0000000-0000-0000-0000-000000000001','1510','Accumulated Depreciation','asset'),
  ('a0000000-0000-0000-0000-000000000001','2000','Accounts Payable','liability'),
  ('a0000000-0000-0000-0000-000000000001','2100','Output VAT','liability'),
  ('a0000000-0000-0000-0000-000000000001','2110','Withholding Tax Payable','liability'),
  ('a0000000-0000-0000-0000-000000000001','2200','SSS / PhilHealth / HDMF Payable','liability'),
  ('a0000000-0000-0000-0000-000000000001','2300','Loans Payable','liability'),
  ('a0000000-0000-0000-0000-000000000001','3000','Owner''s Capital','equity'),
  ('a0000000-0000-0000-0000-000000000001','3100','Retained Earnings','equity'),
  ('a0000000-0000-0000-0000-000000000001','4000','Service Revenue','income'),
  ('a0000000-0000-0000-0000-000000000001','4100','Interest Income','income'),
  ('a0000000-0000-0000-0000-000000000001','5000','Salaries and Wages','expense'),
  ('a0000000-0000-0000-0000-000000000001','5100','Rent Expense','expense'),
  ('a0000000-0000-0000-0000-000000000001','5200','Utilities Expense','expense'),
  ('a0000000-0000-0000-0000-000000000001','5300','Office Supplies','expense'),
  ('a0000000-0000-0000-0000-000000000001','5400','Depreciation Expense','expense'),
  ('a0000000-0000-0000-0000-000000000001','5500','Professional Fees','expense'),
  ('a0000000-0000-0000-0000-000000000001','5900','Miscellaneous Expense','expense')
ON CONFLICT (org_id, code) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS LAST BLOCK ONLY AFTER enabling Google sign-in AND logging in once at
-- https://scalebooks-web.onrender.com (that creates your auth user). It finds you
-- by email and makes you an Admin. Uncomment, set your email, and run.
-- ════════════════════════════════════════════════════════════════════════════
-- INSERT INTO app_users (id, org_id, email, full_name, role)
-- SELECT u.id, 'a0000000-0000-0000-0000-000000000001', u.email, 'Your Name', 'admin'
-- FROM auth.users u
-- WHERE lower(u.email) = lower('you@example.com')                              -- EDIT
-- ON CONFLICT (id) DO NOTHING;
