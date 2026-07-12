-- ════════════════════════════════════════════════════════════════════════════
-- Disbursements & Check Registry (+ org settings).
-- ════════════════════════════════════════════════════════════════════════════
-- Three portal domains move to Postgres:
--   • checkbooks       — checkbook master (series ranges, next number, one
--                        active book per bank)
--   • check_registry   — issued checks and their lifecycle (Issued → Cleared /
--                        Voided / Stopped / Stale), linked to vouchers/JEs
--   • disbursement_reports — a dated batch of vouchers queued for payment;
--                        report lines + bank-balance snapshot ride as jsonb
-- Plus org_settings (company profile + approval routing), which the voucher &
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
