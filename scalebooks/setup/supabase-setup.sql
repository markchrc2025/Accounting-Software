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

-- ════════════════════════════════════════════════════════════════════════════
-- BOOTSTRAP — app role login, your organization, and chart of accounts
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Give the RLS-bound app role a login. The API connects to the DB as this role.
ALTER ROLE scalebooks_app WITH LOGIN PASSWORD 'CHANGE_ME_app_password';        -- EDIT

-- 2) Your organization (keep this id — it is referenced below and by your admin row).
INSERT INTO organizations (id, name)
VALUES ('a0000000-0000-0000-0000-000000000001', 'Your Company Inc.')           -- EDIT name
ON CONFLICT (id) DO NOTHING;

-- 3) Your real chart of accounts (generated from the Zoho export by
--    setup/generate_coa_sql.py — 158 accounts with parent hierarchy).
INSERT INTO accounts (org_id, code, name, type, subtype, description, normal_balance, is_active) VALUES
  ('a0000000-0000-0000-0000-000000000001','1002','Advances to Emp and Officers','asset','Other Current Asset',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1003','Property, plant and equipment','asset','Fixed Asset','Purchases of furniture and equipment for your office that can be used for a long period of time usually exceeding one year can be tracked with this account.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','1001022','Trade Receivable - Client','asset','Accounts Receivable',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1001640','Cash in Bank - UB Savings','asset','Bank',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1002001','Petty Cash','asset','Cash Equivalents','It is a small amount of cash that is used to pay your minor or casual expenses rather than writing a check.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','1002002','Accounts Receivable from Employees','asset','Other Current Asset','Money paid out to an employee in advance can be tracked here till it''s repaid or shown to be spent for company purposes.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','1002003','Accounts Receivable from Officers','asset','Other Current Asset',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1002004','Undeposited Funds','asset','Cash Equivalents','Record funds received by your company yet to be deposited in a bank as undeposited funds and group them as a current asset in your balance sheet.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','1002005','Revolving Fund - Employees','asset','Cash Equivalents','Revolving fund for employees','debit',true),
  ('a0000000-0000-0000-0000-000000000001','1002184','Cash in Bank - BPI Checking','asset','Bank',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1003001','Work Equipments','asset','Fixed Asset',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1003002','Automobile','asset','Fixed Asset',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1003003','Furnitures and Fixtures','asset','Fixed Asset',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','9003001','Accumulated Depreciation','asset','Fixed Asset',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1004001','Prepaid Expenses','asset','Other Current Asset','An asset account that reports amounts paid in advance while purchasing goods or services from a vendor.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','1004489','Cash in Bank - BDO Savings','asset','Bank','BDO Savings Account','debit',true),
  ('a0000000-0000-0000-0000-000000000001','1007923','Cash in Bank - RCBC Checking','asset','Bank',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1008317','Cash in Bank - Security Bank Checking','asset','Bank',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','1008928','Cash in Bank - UB Checking','asset','Bank','UB Business Checking','debit',true),
  ('a0000000-0000-0000-0000-000000000001','1009001','Deferred Tax Asset','asset','Tax Asset','Any tax which is paid in advance is recorded into the advance tax account. This advance tax payment could be a quarterly, half yearly or yearly payment.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','1009336','Cash in Bank - BPI KCL','asset','Bank',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','8000001','Input Tax','asset','Tax Asset','The amount of money charged to you as Tax on your purchases.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO101','TR - SPX - Province','asset','Accounts Receivable',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO102','TR - SPX NCR+','asset','Accounts Receivable',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO103','Iontech Enterprises Inc.','asset','Accounts Receivable',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO104','Docquity Philippines Corp.','asset','Accounts Receivable','Docquity Philippines Corp.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO105','1Life Inc.','asset','Accounts Receivable','1Life Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO106','TR - Accupoint Systems Inc.','asset','Accounts Receivable','Accupoint Systems Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO107','TR - Adele Fado Trading Corp.','asset','Accounts Receivable','Adele Fado Trading Corp.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO108','TR - ALaundry Comp Inc.','asset','Accounts Receivable','ALaundry Comp Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO109','Allegiance Insurance Agency Inc.','asset','Accounts Receivable','Allegiance Insurance Agency Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO110','Zenorex Marketing Corporation','asset','Accounts Receivable','Zenorex Marketing Corporation','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO111','TR - Beyond Innovation (BEY)','asset','Accounts Receivable','Beyond Innovation','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO112','Boxtalks Inc.','asset','Accounts Receivable','Boxtalks Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO113','TR - Cosmos Bazar Inc.','asset','Accounts Receivable','Cosmos Bazar Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO114','TR - Digits Trading Corp','asset','Accounts Receivable','Digits Trading Corp.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO115','DGNation Inc.','asset','Accounts Receivable','DGNation Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO116','Digital Walker Corp.','asset','Accounts Receivable','Digital Walker Corp.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO117','Digitalks Technology Corp.','asset','Accounts Receivable','Digitalks Technology Corp.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO118','TR - Environmental-Health Laboratory Services Cooperative','asset','Accounts Receivable','Environmental-Health Laboratory Services Cooperative','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO119','TR - F2 Logistics','asset','Accounts Receivable','F2 Logistics Philippines, Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO120','TR - F2 - LAGUNA','asset','Accounts Receivable','F2 Logistics Philippines, Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO121','Great Deals E Commerce Corp.','asset','Accounts Receivable','Great Deals E Commerce Corp.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO122','iClick Digishop Corp','asset','Accounts Receivable','iClick Digishop Corp','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO123','Index 94 Lifestyle Solutions Inc.','asset','Accounts Receivable','Index 94 Lifestyle Solutions Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO124','TR - J&R Appliances','asset','Accounts Receivable','J&R Appliances','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO125','JW Summit Group Inc.','asset','Accounts Receivable','JW Summit Group Inc.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO126','TR - Wise Corp.','asset','Accounts Receivable','Wavelength Imaging Solutions Expert Corporation','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO127','Upson Global','asset','Accounts Receivable','Upson Global','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO128','TR - Sokany Trading Corp','asset','Accounts Receivable','Upson Global','debit',true),
  ('a0000000-0000-0000-0000-000000000001','DO129','TR - Sokany Trading Corp Warehouse','asset','Accounts Receivable','Upson Global','debit',true),
  ('a0000000-0000-0000-0000-000000000001','4002','Cost of Services','expense','Cost of Services','An expense account which tracks the value of the services sold.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','4001001','Salaries and Wages Deployed','expense','Cost of Services','Client Billings for remittance to Social Agencies','debit',true),
  ('a0000000-0000-0000-0000-000000000001','4001002','Accrued 13th Month Pay Deployed','expense','Cost of Services',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','4001003','Recruitment Cost','expense','Cost of Services','Recruitment Cost for mass hiring and job postings','debit',true),
  ('a0000000-0000-0000-0000-000000000001','4002001','SSS ER Share Deployed','expense','Cost of Services',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','4002002','HDMF ER Share Deployed','expense','Cost of Services',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','4002003','PHIC ER Share Deployed','expense','Cost of Services',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','4002004','Employee Incentives Deployed','expense','Cost of Services',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','4002005','Employee Allowances Deployed','expense','Cost of Services',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','2004001','Owner''s Equity','equity','Equity','The owners rights to the assets of a company can be quantified in the owner''''s equity account.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2004002','Opening Balance Offset','equity','Equity','This is an account where you can record the balance from your previous years earning or the amount set aside for some activities. It is like a buffer account for your funds.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2004003','Retained Earnings','equity','Equity','The earnings of your company which are not distributed among the share holders is accounted as retained earnings.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','5001','Personnel Cost','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002','General and Administrative Expenses','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5003','Utilities','expense','Utilities',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5004','Finance Cost and Amortization','expense','Finance Cost and Amortization',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5005','Taxes and Licenses','expense','Taxes and Licenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001001','Salaries and Wages','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001002','Overtime Pay','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001003','13th Month Pay','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001004','Personnel Allowance','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001005','Clothing Allowance','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001006','SSS Premium ER Share','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001007','HDMF Premium ER Share','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001008','PHIC Premium ER Share','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001009','HMO Benefits','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001010','STIP - Employees','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001011','STIP - Officers','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001012','Last Pay to Employees','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001013','Insurance - Disability','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001014','Insurance - Liability','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001015','Insurance - General','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001016','Management compensation','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5001017','Accrued Medical Exam for Employees','expense','Personnel Cost',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002001','Advertising and Promotion','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002002','Fuel and Oil','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002003','Miscellaneous','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002004','Office Supplies','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002005','Repairs and Maintenance - Materials/Supplies','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002006','Representation and Entertainment','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002007','Meals and Transportation','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002008','Gatherings and Teambuildings','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002009','Dues and subscriptions','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002010','Equipment Rental','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002011','Checkbook Reorder','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002012','Training and Development','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002013','Professional Services','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002014','Interest Expense','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002015','Shipping and Delivery Expense','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002016','Rental HO','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002017','Rental Branch','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002018','Lodging','expense','General and Administrative Expenses','Any expense related to putting up at motels etc while on business travel can be entered here.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002019','Other Selling Expenses','expense','General and Administrative Expenses','Any minor expense on activities unrelated to primary business operations is recorded under the other expense account.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002020','Credit Card Charges','expense','General and Administrative Expenses','Service fees for transactions , balance transfer fees, annual credit fees and other charges levied on a credit card are recorded into the credit card account.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002021','Bank Fees and Charges','expense','General and Administrative Expenses','Any bank fees levied is recorded into the bank fees and charges account. A bank account maintenance fee, transaction charges, a late payment fee are some examples.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','5002022','Other general and administrative expenses','expense','General and Administrative Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5003001','Electricity','expense','Utilities',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5003002','Communication','expense','Utilities',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5003003','Water','expense','Utilities',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5004001','Finance Cost','expense','Finance Cost and Amortization',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5004002','Amortization','expense','Finance Cost and Amortization',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5004003','Bad Debt','expense','Non Cash Expenses','Any amount which is lost and is unrecoverable is recorded into the bad debt account.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','5004004','Depreciation Expense','expense','Non Cash Expenses','Any depreciation in value of your assets can be captured as a depreciation expense.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','5005001','Business and Income Tax','expense','Taxes and Licenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5005002','Business Licenses and Permits','expense','Taxes and Licenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','5006001','Exchange Gain or Loss','expense','Other Expense','Changing the conversion rate can result in a gain or a loss. You can record this into the exchange gain or loss account.','debit',true),
  ('a0000000-0000-0000-0000-000000000001','5900000','Other General Expenses','expense','Other General Expenses',NULL,'debit',true),
  ('a0000000-0000-0000-0000-000000000001','3001001','Manpower Service Revenue','income','Income','The income from the sales in your business is recorded under the sales account.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','3001002','SaaS Revenue','income','Income',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','3001003','Placement Service Revenue','income','Income','Headhunting / Placement Services','credit',true),
  ('a0000000-0000-0000-0000-000000000001','3001004','Billable Expense Income','income','Income','Charges to clients (SSS, Philhealth, Pagibig and other Allowances)','credit',true),
  ('a0000000-0000-0000-0000-000000000001','3001005','Bank Fees Recovered','income','Income','Bank Fees charged to employees without Payroll bank account','credit',true),
  ('a0000000-0000-0000-0000-000000000001','3001006','Other Services Revenue','income','Other Income',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','3001007','Interest Income','income','Other Income','A percentage of your balances and deposits are given as interest to you by your banks and financial institutions. This interest is recorded into the interest income account.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','3901001','Discount','income','Income','Any reduction on your selling price as a discount can be recorded into the discount account.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2001','Short Term Debt','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2002','Accounts Payable to Emp and Officers','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2003','Tax Payable','liability','Tax Liability','The amount of money which you owe to your tax authority is recorded under the tax payable account. This amount is a sum of your outstanding in taxes and the tax charged on sales.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2008','Social Agency Contribution Payable','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2009','Employee Benefit Claims Payable','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2101','Expanded Withholding Tax Payable','liability','Tax Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2001001','Accounts Payable','liability','Accounts Payable','This is an account of all the money which you owe to others like a pending bill payment to a vendor,etc.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2001002','Loans Payable','liability','Accounts Payable','This is an account of all the money which you owe to others like a pending bill payment to a vendor,etc.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2001003','Fixed Assets Payable','liability','Accounts Payable','This is an account of installment clearing account of Fixed Assets','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2002001','Employee Reimbursements','liability','Other Current Liability','This account can be used to track the reimbursements that are due to be paid out to employees.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2002002','Accounts Payable to Shareholders','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2003001','Deferred Tax Liability','liability','Tax Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2003002','Income Tax Payable','liability','Tax Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2003003','Output Tax','liability','Tax Liability','The amount of money charged as Tax on your sales.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2004001','Salaries and Wages Payable','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2004002','Final Pay Payable Deployed','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2004003','Final Pay Payable','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2008001','SSS EmployER Contribution','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2008002','HDMF EmployER Contribution','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2008003','PHIC EmployER Contribution','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2008004','SSS EmployEE Contribution','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2008005','HDMF EmployEE Contribution','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2008006','PHIC EmployEE Contribution','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2009001','SSS Employee Loans and Benefits','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2009002','HDMF Employee Loans and Benefits','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2009003','13th Month Payable','liability','Other Current Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2101001','Withholding Tax on Compensation Payable','liability','Tax Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2101002','EWT Vendors','liability','Tax Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2101003','Final Withholding Tax Payable','liability','Tax Liability',NULL,'credit',true),
  ('a0000000-0000-0000-0000-000000000001','2600001','Unearned Revenue','liability','Other Current Liability','A liability account that reports amounts received in advance of providing goods or services. When the goods or services are provided, this account balance is decreased and a revenue account is increased.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2700001','Opening Balance Adjustments','liability','Other Current Liability','This account will hold the difference in the debits and credits entered during the opening balance.','credit',true),
  ('a0000000-0000-0000-0000-000000000001','2800001','Post-Dated Checks Issued','liability','Other Current Liability',NULL,'credit',true)
ON CONFLICT (org_id, name) DO NOTHING;

-- Resolve the parent hierarchy by name (parents are referenced by name in the export).
WITH parent_map (child_name, parent_name) AS (VALUES
  ('Accounts Receivable from Employees','Advances to Emp and Officers'),
  ('Accounts Receivable from Officers','Advances to Emp and Officers'),
  ('Work Equipments','Property, plant and equipment'),
  ('Automobile','Property, plant and equipment'),
  ('Furnitures and Fixtures','Property, plant and equipment'),
  ('Accumulated Depreciation','Property, plant and equipment'),
  ('TR - SPX - Province','Trade Receivable - Client'),
  ('TR - SPX NCR+','Trade Receivable - Client'),
  ('Iontech Enterprises Inc.','Trade Receivable - Client'),
  ('Docquity Philippines Corp.','Trade Receivable - Client'),
  ('1Life Inc.','Trade Receivable - Client'),
  ('TR - Accupoint Systems Inc.','Trade Receivable - Client'),
  ('TR - Adele Fado Trading Corp.','Trade Receivable - Client'),
  ('TR - ALaundry Comp Inc.','Trade Receivable - Client'),
  ('Allegiance Insurance Agency Inc.','Trade Receivable - Client'),
  ('Zenorex Marketing Corporation','Trade Receivable - Client'),
  ('TR - Beyond Innovation (BEY)','Trade Receivable - Client'),
  ('Boxtalks Inc.','Trade Receivable - Client'),
  ('TR - Cosmos Bazar Inc.','Trade Receivable - Client'),
  ('TR - Digits Trading Corp','Trade Receivable - Client'),
  ('DGNation Inc.','Trade Receivable - Client'),
  ('Digital Walker Corp.','Trade Receivable - Client'),
  ('Digitalks Technology Corp.','Trade Receivable - Client'),
  ('TR - Environmental-Health Laboratory Services Cooperative','Trade Receivable - Client'),
  ('TR - F2 Logistics','Trade Receivable - Client'),
  ('TR - F2 - LAGUNA','Trade Receivable - Client'),
  ('Great Deals E Commerce Corp.','Trade Receivable - Client'),
  ('iClick Digishop Corp','Trade Receivable - Client'),
  ('Index 94 Lifestyle Solutions Inc.','Trade Receivable - Client'),
  ('TR - J&R Appliances','Trade Receivable - Client'),
  ('JW Summit Group Inc.','Trade Receivable - Client'),
  ('TR - Wise Corp.','Trade Receivable - Client'),
  ('Upson Global','Trade Receivable - Client'),
  ('TR - Sokany Trading Corp','Trade Receivable - Client'),
  ('TR - Sokany Trading Corp Warehouse','Trade Receivable - Client'),
  ('Salaries and Wages Deployed','Cost of Services'),
  ('Accrued 13th Month Pay Deployed','Cost of Services'),
  ('Recruitment Cost','Cost of Services'),
  ('SSS ER Share Deployed','Cost of Services'),
  ('HDMF ER Share Deployed','Cost of Services'),
  ('PHIC ER Share Deployed','Cost of Services'),
  ('Employee Incentives Deployed','Cost of Services'),
  ('Employee Allowances Deployed','Cost of Services'),
  ('Salaries and Wages','Personnel Cost'),
  ('Overtime Pay','Personnel Cost'),
  ('13th Month Pay','Personnel Cost'),
  ('Personnel Allowance','Personnel Cost'),
  ('Clothing Allowance','Personnel Cost'),
  ('SSS Premium ER Share','Personnel Cost'),
  ('HDMF Premium ER Share','Personnel Cost'),
  ('PHIC Premium ER Share','Personnel Cost'),
  ('HMO Benefits','Personnel Cost'),
  ('STIP - Employees','Personnel Cost'),
  ('STIP - Officers','Personnel Cost'),
  ('Last Pay to Employees','Personnel Cost'),
  ('Insurance - Disability','Personnel Cost'),
  ('Insurance - Liability','Personnel Cost'),
  ('Insurance - General','Personnel Cost'),
  ('Management compensation','Personnel Cost'),
  ('Accrued Medical Exam for Employees','Personnel Cost'),
  ('Advertising and Promotion','General and Administrative Expenses'),
  ('Fuel and Oil','General and Administrative Expenses'),
  ('Miscellaneous','General and Administrative Expenses'),
  ('Office Supplies','General and Administrative Expenses'),
  ('Repairs and Maintenance - Materials/Supplies','General and Administrative Expenses'),
  ('Representation and Entertainment','General and Administrative Expenses'),
  ('Meals and Transportation','General and Administrative Expenses'),
  ('Gatherings and Teambuildings','General and Administrative Expenses'),
  ('Dues and subscriptions','General and Administrative Expenses'),
  ('Equipment Rental','General and Administrative Expenses'),
  ('Checkbook Reorder','General and Administrative Expenses'),
  ('Training and Development','General and Administrative Expenses'),
  ('Professional Services','General and Administrative Expenses'),
  ('Interest Expense','General and Administrative Expenses'),
  ('Shipping and Delivery Expense','General and Administrative Expenses'),
  ('Rental HO','General and Administrative Expenses'),
  ('Rental Branch','General and Administrative Expenses'),
  ('Lodging','General and Administrative Expenses'),
  ('Other Selling Expenses','General and Administrative Expenses'),
  ('Credit Card Charges','General and Administrative Expenses'),
  ('Electricity','Utilities'),
  ('Communication','Utilities'),
  ('Water','Utilities'),
  ('Finance Cost','Finance Cost and Amortization'),
  ('Amortization','Finance Cost and Amortization'),
  ('Business and Income Tax','Taxes and Licenses'),
  ('Business Licenses and Permits','Taxes and Licenses'),
  ('Accounts Payable','Short Term Debt'),
  ('Loans Payable','Short Term Debt'),
  ('Fixed Assets Payable','Short Term Debt'),
  ('Employee Reimbursements','Accounts Payable to Emp and Officers'),
  ('Accounts Payable to Shareholders','Accounts Payable to Emp and Officers'),
  ('SSS EmployER Contribution','Social Agency Contribution Payable'),
  ('HDMF EmployER Contribution','Social Agency Contribution Payable'),
  ('PHIC EmployER Contribution','Social Agency Contribution Payable'),
  ('SSS EmployEE Contribution','Social Agency Contribution Payable'),
  ('HDMF EmployEE Contribution','Social Agency Contribution Payable'),
  ('PHIC EmployEE Contribution','Social Agency Contribution Payable'),
  ('SSS Employee Loans and Benefits','Employee Benefit Claims Payable'),
  ('HDMF Employee Loans and Benefits','Employee Benefit Claims Payable'),
  ('13th Month Payable','Employee Benefit Claims Payable'),
  ('Withholding Tax on Compensation Payable','Expanded Withholding Tax Payable'),
  ('EWT Vendors','Expanded Withholding Tax Payable'),
  ('Final Withholding Tax Payable','Expanded Withholding Tax Payable')
)
UPDATE accounts c
SET parent_id = p.id
FROM parent_map m
JOIN accounts p ON p.org_id = 'a0000000-0000-0000-0000-000000000001' AND p.name = m.parent_name
WHERE c.org_id = 'a0000000-0000-0000-0000-000000000001' AND c.name = m.child_name;

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
