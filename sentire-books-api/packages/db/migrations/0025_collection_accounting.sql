-- ════════════════════════════════════════════════════════════════════════════
-- Collections → General Ledger (M2.2), plus collection ⇄ invoice application.
-- ════════════════════════════════════════════════════════════════════════════
-- Posting a collection relieves the receivable and books the cash:
--
--     DR  Cash in Bank                 amount_received
--     DR  Creditable Withholding Tax   ewt            (omitted when zero)
--         CR  Trade Receivable             amount_received + ewt
--
-- Two things this schema has to get right:
--
-- 1. EWT IS CAPTURED, NOT DERIVED. The payor computes what they withhold and
--    hands us BIR Form 2307; deriving it server-side would guarantee eventual
--    disagreement with the certificate we are legally required to match. So
--    `ewt_cents` is an input. The tax base is the amount NET of VAT — the API
--    asserts that, because withholding on the VAT-inclusive total is the
--    classic and expensive error.
--
-- 2. AR RELIEF IS COMPUTED BY THE DATABASE. `ar_relief_cents` is GENERATED as
--    amount_received + ewt, so the credit line of the journal entry and the
--    sub-ledger read the same number from the same place and cannot drift.
--
-- `collection_applications` replaces the `si_id text` soft link. A real
-- collection settles several invoices at once, and AR aging (M2.4) needs
-- invoice-level balances to be trustworthy.

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS ewt_cents                bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_account_code        text,
  ADD COLUMN IF NOT EXISTS cwt_account_code         text,
  ADD COLUMN IF NOT EXISTS ar_account_code          text,
  ADD COLUMN IF NOT EXISTS booking_journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS booked_at                timestamptz,
  ADD COLUMN IF NOT EXISTS booking_mode             text,
  -- Percentage tax (Sec. 116) accrues against receipts for non-VAT tenants, as
  -- a SEPARATE entry so cash and tax can be reversed independently.
  ADD COLUMN IF NOT EXISTS percentage_tax_cents          bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percentage_tax_rate           numeric(9,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percentage_tax_journal_entry_id uuid;

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

-- ── collection_applications — which invoices a collection settles ───────────
CREATE TABLE IF NOT EXISTS collection_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid   NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  collection_id uuid   NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  invoice_id    uuid   NOT NULL REFERENCES service_invoices(id),
  -- Cash applied to this invoice, and the EWT withheld on this invoice's share.
  -- Their sum is what this application relieves from the receivable.
  applied_cents bigint NOT NULL DEFAULT 0 CHECK (applied_cents >= 0),
  ewt_cents     bigint NOT NULL DEFAULT 0 CHECK (ewt_cents >= 0),
  relief_cents  bigint GENERATED ALWAYS AS (applied_cents + ewt_cents) STORED,
  created_by    text REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- One row per (collection, invoice) pair; apply more by updating, not stacking.
  UNIQUE (collection_id, invoice_id),
  -- An application that relieves nothing is a data-entry mistake, not a no-op.
  CONSTRAINT collection_applications_nonzero_chk CHECK (applied_cents + ewt_cents > 0)
);
CREATE INDEX IF NOT EXISTS collection_applications_org_invoice_idx
  ON collection_applications (org_id, invoice_id);
CREATE INDEX IF NOT EXISTS collection_applications_org_collection_idx
  ON collection_applications (org_id, collection_id);

-- Org-scoped RLS + app-role grants, matching the 0015 block.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE collection_applications ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS org_isolation ON collection_applications';
  EXECUTE 'CREATE POLICY org_isolation ON collection_applications USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON collection_applications TO sentire_books_app';
END $$;

-- Re-assert on collections too (already present from 0015).
DO $$
BEGIN
  EXECUTE 'ALTER TABLE collections ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'collections' AND policyname = 'org_isolation') THEN
    EXECUTE 'CREATE POLICY org_isolation ON collections USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())';
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON collections TO sentire_books_app';
END $$;
