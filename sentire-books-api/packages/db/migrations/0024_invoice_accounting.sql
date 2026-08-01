-- ════════════════════════════════════════════════════════════════════════════
-- Service Invoice → General Ledger integration (M2.1: invoice issuance).
-- ════════════════════════════════════════════════════════════════════════════
-- Invoices become the AR sub-ledger's source document: ISSUING an invoice posts
-- its revenue entry so the receivable and the income land on the books.
--
-- The invoice could not previously answer "how much of this is VAT?" — it
-- carried a single `amount_cents` plus a free-text `tax_type`. A posting engine
-- needs the decomposition, so:
--
--   • net_cents / vat_cents — the VAT-exclusive tax base and the output VAT.
--     A CHECK keeps amount_cents = net_cents + vat_cents, so the invoice total
--     and its parts cannot drift apart in ANY code path. Same "the database
--     enforces it" property the balance triggers give the ledger.
--
--   • vat_treatment — 'vatable' | 'exempt' | 'zero_rated' | 'none'.
--     NOT derivable from the journal entry: a VAT-exempt sale and a non-VAT
--     (percentage-tax) sale post identical lines. They diverge downstream —
--     the VAT return splits exempt from zero-rated, and only 'none' triggers
--     the Sec. 116 percentage-tax accrual on collection. So the distinction
--     has to live on the invoice.
--
--   • ar_account_code / income_account_code / output_vat_account_code —
--     SNAPSHOTTED at issuance. The AR account is resolved from the customer
--     contact at the moment we post; recording it here means editing the
--     contact later cannot retroactively move history to a different account.
--
--   • booking_journal_entry_id / booked_at / booking_mode — mirroring loans
--     and fixed assets. An invoice books once; cancelling reverses.
--
-- VAT basis: ACCRUAL AT ISSUANCE (RA 11976 / EOPT — the Invoice is the primary
-- document for services and output VAT accrues on billing, not collection).
-- Collection-basis would instead credit a Deferred Output VAT account here and
-- reclassify on receipt; that account is deliberately NOT created.

ALTER TABLE service_invoices
  ADD COLUMN IF NOT EXISTS net_cents                bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_cents                bigint  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_treatment            text    NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ar_account_code          text,
  ADD COLUMN IF NOT EXISTS output_vat_account_code  text,
  ADD COLUMN IF NOT EXISTS booking_journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS booked_at                timestamptz,
  ADD COLUMN IF NOT EXISTS booking_mode             text;

-- Backfill before constraining: existing rows carry the whole amount in
-- amount_cents with no VAT split, which is exactly "net, no VAT".
UPDATE service_invoices
   SET net_cents = amount_cents
 WHERE net_cents = 0 AND vat_cents = 0 AND amount_cents <> 0;

-- The arithmetic guard. Added only once, and only if the data satisfies it —
-- an org with hand-edited rows gets a loud failure here rather than a silent
-- mis-posting later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_invoices_amount_decomposed_chk'
  ) THEN
    ALTER TABLE service_invoices
      ADD CONSTRAINT service_invoices_amount_decomposed_chk
      CHECK (amount_cents = net_cents + vat_cents);
  END IF;
END $$;

-- Non-negative parts: a negative net or VAT would balance but is never a real
-- invoice (credit notes are a separate document, not a negative invoice).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_invoices_parts_nonneg_chk'
  ) THEN
    ALTER TABLE service_invoices
      ADD CONSTRAINT service_invoices_parts_nonneg_chk
      CHECK (net_cents >= 0 AND vat_cents >= 0);
  END IF;
END $$;

-- One booked invoice ↔ one journal entry. Partial index: many invoices are
-- unbooked (NULL), and NULLs must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS service_invoices_booking_je_key
  ON service_invoices (booking_journal_entry_id)
  WHERE booking_journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_invoices_org_status_idx
  ON service_invoices (org_id, status);

-- RLS is already enabled on service_invoices with an org_isolation policy and
-- app-role grants (0015_billing_ar.sql); adding columns does not change that.
-- Re-asserted here so a partial restore cannot leave the table open.
DO $$
BEGIN
  EXECUTE 'ALTER TABLE service_invoices ENABLE ROW LEVEL SECURITY';
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'service_invoices' AND policyname = 'org_isolation') THEN
    EXECUTE 'CREATE POLICY org_isolation ON service_invoices USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id())';
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON service_invoices TO sentire_books_app';
END $$;
