-- ════════════════════════════════════════════════════════════════════════════
-- PRODUCTION DELTA — run as the DATABASE OWNER in pgAdmin BEFORE redeploying
-- the API build that contains M2.2 (collections → GL).
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHY BEFORE: the M2.2 API selects collections.ewt_cents / ar_relief_cents /
-- booking_journal_entry_id and reads/writes collection_applications. Deploying
-- the code first makes every collection list and post fail with "column does
-- not exist" / "relation does not exist". Applying this first is
-- backwards-compatible: everything here is additive and the CURRENT build
-- ignores it.
--
-- ORDER: livedbdelta0023.sql → livedbdelta0024.sql → THIS FILE.
--
-- Idempotent — safe to run twice. Wrapped in a transaction.

BEGIN;

-- ── 1. Collections gain the EWT capture + booking stamps ────────────────────
ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS ewt_cents                bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_account_code        text,
  ADD COLUMN IF NOT EXISTS cwt_account_code         text,
  ADD COLUMN IF NOT EXISTS ar_account_code          text,
  ADD COLUMN IF NOT EXISTS booking_journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS booked_at                timestamptz,
  ADD COLUMN IF NOT EXISTS booking_mode             text,
  ADD COLUMN IF NOT EXISTS percentage_tax_cents            bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percentage_tax_rate             numeric(9,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percentage_tax_journal_entry_id uuid;

-- AR relief = cash + EWT, computed by the DATABASE so the journal entry and the
-- sub-ledger read the same number from the same place.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'collections' AND column_name = 'ar_relief_cents'
  ) THEN
    ALTER TABLE collections
      ADD COLUMN ar_relief_cents bigint
      GENERATED ALWAYS AS (amount_received_cents + ewt_cents) STORED;
  END IF;
END $$;

-- Pre-flight: a pre-existing negative amount would fail the new CHECK.
DO $$
DECLARE bad int;
BEGIN
  SELECT count(*) INTO bad FROM collections WHERE amount_received_cents < 0;
  IF bad > 0 THEN
    RAISE EXCEPTION
      'ABORT: % collections row(s) with a negative amount_received_cents. '
      'Inspect: SELECT id, collection_no, amount_received_cents FROM collections '
      'WHERE amount_received_cents < 0;', bad;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collections_ewt_nonneg_chk') THEN
    ALTER TABLE collections ADD CONSTRAINT collections_ewt_nonneg_chk
      CHECK (ewt_cents >= 0 AND amount_received_cents >= 0 AND percentage_tax_cents >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS collections_booking_je_key
  ON collections (booking_journal_entry_id) WHERE booking_journal_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS collections_org_status_idx ON collections (org_id, status);

-- ── 2. collection_applications — which invoices a collection settles ────────
-- Replaces the `si_id text` soft link: real collections settle several invoices
-- at once, and AR aging needs invoice-level balances to be trustworthy.
CREATE TABLE IF NOT EXISTS collection_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid   NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  collection_id uuid   NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  invoice_id    uuid   NOT NULL REFERENCES service_invoices(id),
  applied_cents bigint NOT NULL DEFAULT 0 CHECK (applied_cents >= 0),
  ewt_cents     bigint NOT NULL DEFAULT 0 CHECK (ewt_cents >= 0),
  relief_cents  bigint GENERATED ALWAYS AS (applied_cents + ewt_cents) STORED,
  created_by    text REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, invoice_id),
  CONSTRAINT collection_applications_nonzero_chk CHECK (applied_cents + ewt_cents > 0)
);
CREATE INDEX IF NOT EXISTS collection_applications_org_invoice_idx
  ON collection_applications (org_id, invoice_id);
CREATE INDEX IF NOT EXISTS collection_applications_org_collection_idx
  ON collection_applications (org_id, collection_id);

-- ── 3. RLS + grants — REQUIRED, this is a new tenant table ──────────────────
ALTER TABLE collection_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON collection_applications;
CREATE POLICY org_isolation ON collection_applications
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON collection_applications TO sentire_books_app;

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON collections TO sentire_books_app;

COMMIT;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- RLS must be ON with a policy — a new tenant table without it is a leak:
--   SELECT relname, relrowsecurity FROM pg_class WHERE relname='collection_applications';
--   SELECT policyname FROM pg_policies WHERE tablename='collection_applications';
--
-- The generated column must exist:
--   SELECT column_name, is_generated FROM information_schema.columns
--    WHERE table_name='collections' AND column_name='ar_relief_cents';
--
-- ── Optional: configure the Sec. 116 rate ───────────────────────────────────
-- The API falls back to the statutory 3%. To set it explicitly per workspace:
--   INSERT INTO tax_rates (org_id, name, rate, is_active)
--   VALUES ('<your-org-id>', 'Percentage Tax', 3.0000, true)
--   ON CONFLICT (org_id, name) DO UPDATE SET rate = EXCLUDED.rate;
