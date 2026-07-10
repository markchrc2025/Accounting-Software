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
