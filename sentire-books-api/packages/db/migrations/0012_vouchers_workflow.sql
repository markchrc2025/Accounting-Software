-- ════════════════════════════════════════════════════════════════════════════
-- Voucher approval workflow + persisted voucher lines.
-- ════════════════════════════════════════════════════════════════════════════
-- The portal treats a voucher as an approvable document: Draft → Pending →
-- For Verification → Verified → For Approval → Approved → Paid (plus Rejected
-- and Voided='void'). The journal entry is posted only at APPROVAL, built from
-- the voucher's own persisted lines — before that the voucher is a mutable
-- document with no ledger effect. (The legacy atomic create-and-post path the
-- simple app uses is unchanged.)

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

-- The voucher's own line items (what the edit form and PDF re-hydrate from).
-- They become journal_lines only when the voucher is approved. `meta` carries
-- client-side per-line config (e.g. tax selections) losslessly until the tax
-- subsystem owns it.
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

-- Org-scoped RLS via the parent voucher (voucher_lines has no org_id of its own).
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
