-- ════════════════════════════════════════════════════════════════════════════
-- Sentire Books LIVE DB: VOUCHERS CATCH-UP (replaces live-db-delta-0012.sql).
-- Your live DB is missing the vouchers migration entirely (0004) — this script
-- creates it in its final shape AND applies the 0012 workflow on top.
-- Run as `owner` on sentire_books. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Enum types — created with the FULL value set when missing; extended
--    value-by-value when they already exist.
DO $$ BEGIN
  CREATE TYPE voucher_type AS ENUM
    ('payment','receipt','payroll','final_pay','loan','check');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE voucher_status AS ENUM
    ('draft','pending','for_verification','verified','for_approval',
     'approved','paid','rejected','posted','void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

-- 2) vouchers table in its FINAL shape (created_by is text post-0007; includes
--    the 0012 columns). ADD COLUMN guards cover a partially-created table.
CREATE TABLE IF NOT EXISTS vouchers (
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
  purpose_category        text,
  payment_from_account_id uuid REFERENCES accounts(id),
  notes            text,
  meta             jsonb,
  created_by       text REFERENCES app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  posted_at        timestamptz,
  UNIQUE (org_id, voucher_no)
);
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS purpose_category        text,
  ADD COLUMN IF NOT EXISTS payment_from_account_id uuid REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS notes                   text,
  ADD COLUMN IF NOT EXISTS meta                    jsonb;
CREATE INDEX IF NOT EXISTS vouchers_org_date_idx ON vouchers (org_id, voucher_date);

ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON vouchers;
CREATE POLICY org_isolation ON vouchers
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON vouchers TO sentire_books_app;

-- 3) voucher_lines (0012)
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

-- ── Verify + health check ─────────────────────────────────────────────────────
-- First row: this catch-up. Expect vouchers / voucher_lines / 10 / 1.
SELECT
  to_regclass('public.vouchers')       AS vouchers_ok,
  to_regclass('public.voucher_lines')  AS voucher_lines_ok,
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'voucher_status') AS voucher_status_values,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'vouchers' AND column_name = 'purpose_category') AS vouchers_0012_ok;

-- Second: whole-schema health — every row should say true. Any false = tell me.
SELECT t.name AS expected_object,
       to_regclass('public.' || t.name) IS NOT NULL AS exists
FROM (VALUES ('organizations'),('app_users'),('accounts'),('journal_entries'),
             ('journal_lines'),('contacts'),('vouchers'),('voucher_lines'),
             ('document_counters')) AS t(name);
