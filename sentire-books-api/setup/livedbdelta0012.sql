-- ════════════════════════════════════════════════════════════════════════════
-- Sentire Books LIVE DB catch-up: migration 0012 ONLY (voucher workflow).
-- Run as `owner` on the sentire_books database (pgAdmin). Safe to re-run.
-- Prerequisite: the 0010+0011 delta you already applied.
-- ════════════════════════════════════════════════════════════════════════════

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

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT
  to_regclass('public.voucher_lines')                                          AS voucher_lines_ok,   -- expect voucher_lines
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'voucher_status')                                        AS voucher_status_values, -- expect 10
  (SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'vouchers' AND column_name = 'purpose_category')        AS vouchers_0012_ok;   -- expect 1
