-- ════════════════════════════════════════════════════════════════════════════
-- Fixed Asset → General Ledger integration (acquisition booking).
-- ════════════════════════════════════════════════════════════════════════════
-- Fixed assets become a true sub-ledger of the books: registering an asset posts
-- its acquisition journal entry so the asset cost lands on the Balance Sheet.
-- Run this BEFORE (or right as) the API redeploys — the new API selects these
-- columns, so the Fixed Assets list 500s until they exist.
--
--   • cash_account_code — cash/bank credited on a cash purchase (or installment
--     down payment). Resolves to an account id at post time.
--   • booking_mode — 'cash' | 'installment' | 'opening_balance'.
--   • booking_journal_entry_id / booked_at — set when the asset is booked; an
--     asset books once (cancel reverses it and clears these).

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS cash_account_code         text,
  ADD COLUMN IF NOT EXISTS booking_mode              text,   -- 'cash' | 'installment' | 'opening_balance'
  ADD COLUMN IF NOT EXISTS booking_journal_entry_id  uuid,
  ADD COLUMN IF NOT EXISTS booked_at                 timestamptz;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: all four columns present (booking_columns = 4).
SELECT count(*) AS booking_columns
  FROM information_schema.columns
 WHERE table_name = 'fixed_assets'
   AND column_name IN ('cash_account_code', 'booking_mode', 'booking_journal_entry_id', 'booked_at');
