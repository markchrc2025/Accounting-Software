-- ════════════════════════════════════════════════════════════════════════════
-- PRODUCTION DELTA — run as the DATABASE OWNER in pgAdmin BEFORE redeploying
-- the API build that contains M2.1 (invoice issuance → GL).
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY BEFORE: the M2.1 API selects service_invoices.net_cents / vat_cents /
-- vat_treatment / booking_journal_entry_id. Deploying the code first makes
-- every invoice list and every issue attempt fail with "column does not exist".
-- Applying this first is backwards-compatible: the columns are additive and the
-- CURRENT build ignores them.
--
-- ORDER: apply livedbdelta0023.sql first if it has not been applied yet.
--
-- Idempotent — safe to run twice. Wrapped in a transaction so a mid-way failure
-- leaves nothing half-applied.

BEGIN;

-- 1. The VAT decomposition + booking stamps.
ALTER TABLE service_invoices
  ADD COLUMN IF NOT EXISTS net_cents                bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_cents                bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_treatment            text    NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ar_account_code          text,
  ADD COLUMN IF NOT EXISTS output_vat_account_code  text,
  ADD COLUMN IF NOT EXISTS booking_journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS booked_at                timestamptz,
  ADD COLUMN IF NOT EXISTS booking_mode             text;

-- 2. Backfill: existing rows hold the whole amount with no VAT split, which is
--    exactly "net, no VAT". Must run BEFORE the CHECK is added.
UPDATE service_invoices
   SET net_cents = amount_cents
 WHERE net_cents = 0 AND vat_cents = 0 AND amount_cents <> 0;

-- 3. Pre-flight: if any row still fails the identity, STOP with a loud error
--    rather than letting the ALTER fail with a less helpful message.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM service_invoices
   WHERE amount_cents <> net_cents + vat_cents;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'ABORT: % service_invoices row(s) where amount_cents <> net_cents + vat_cents. '
      'Inspect them before applying: SELECT id, si_no, amount_cents, net_cents, vat_cents '
      'FROM service_invoices WHERE amount_cents <> net_cents + vat_cents;', bad;
  END IF;
END $$;

-- 4. The arithmetic guards.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_invoices_amount_decomposed_chk') THEN
    ALTER TABLE service_invoices
      ADD CONSTRAINT service_invoices_amount_decomposed_chk
      CHECK (amount_cents = net_cents + vat_cents);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_invoices_parts_nonneg_chk') THEN
    ALTER TABLE service_invoices
      ADD CONSTRAINT service_invoices_parts_nonneg_chk
      CHECK (net_cents >= 0 AND vat_cents >= 0);
  END IF;
END $$;

-- 5. Indexes.
CREATE UNIQUE INDEX IF NOT EXISTS service_invoices_booking_je_key
  ON service_invoices (booking_journal_entry_id)
  WHERE booking_journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_invoices_org_status_idx
  ON service_invoices (org_id, status);

-- 6. Re-assert RLS + grants (already present from 0015; belt and braces).
ALTER TABLE service_invoices ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_invoices' AND policyname = 'org_isolation') THEN
    EXECUTE 'CREATE POLICY org_isolation ON service_invoices USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())';
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_invoices TO sentire_books_app;

COMMIT;

-- ── Verify (expect 8 columns, 2 constraints, RLS true) ──────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name='service_invoices'
--    AND column_name IN ('net_cents','vat_cents','vat_treatment','ar_account_code',
--                        'output_vat_account_code','booking_journal_entry_id','booked_at','booking_mode')
--  ORDER BY column_name;
-- SELECT conname FROM pg_constraint WHERE conrelid='service_invoices'::regclass AND contype='c';
-- SELECT relrowsecurity FROM pg_class WHERE relname='service_invoices';
