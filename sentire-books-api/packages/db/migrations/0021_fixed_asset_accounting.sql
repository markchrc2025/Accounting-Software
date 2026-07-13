-- ════════════════════════════════════════════════════════════════════════════
-- Fixed Asset → General Ledger integration (acquisition booking).
-- ════════════════════════════════════════════════════════════════════════════
-- Fixed assets become a true sub-ledger of the books: registering an asset posts
-- its acquisition journal entry so the asset cost lands on the Balance Sheet.
-- Depreciation posting (Post Depreciation) and installment payments (vouchers)
-- already hit the GL; this closes the loop on the acquisition side.
--
--   • cash_account_code — the cash/bank account a cash purchase (or an
--     installment down payment) credits. Resolves to an account id at post time.
--   • booking_mode — 'cash' | 'installment' | 'opening_balance'.
--   • booking_journal_entry_id / booked_at — set when the asset is booked; an
--     asset books once (cancel reverses it and clears these).

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS cash_account_code         text,
  ADD COLUMN IF NOT EXISTS booking_mode              text,   -- 'cash' | 'installment' | 'opening_balance'
  ADD COLUMN IF NOT EXISTS booking_journal_entry_id  uuid,
  ADD COLUMN IF NOT EXISTS booked_at                 timestamptz;
