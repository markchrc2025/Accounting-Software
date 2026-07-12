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
