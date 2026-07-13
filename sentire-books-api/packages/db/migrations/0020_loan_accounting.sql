-- ════════════════════════════════════════════════════════════════════════════
-- Loan → General Ledger integration (part 1: booking the loan).
-- ════════════════════════════════════════════════════════════════════════════
-- Loans become a true sub-ledger of the books: each loan carries the accounts
-- its entries hit, and "booking" a loan posts its origination journal entry so
-- the liability appears on the Balance Sheet. Payment posting (through the
-- voucher/disbursement flow) lands in a later migration.
--
--   • liability/finance-cost/cash account codes — the accounts the booking JE
--     (and later the payment JEs) use. Codes resolve to account ids at post
--     time, matching how the rest of the app references accounts.
--   • booking_journal_entry_id / booked_at / booking_mode — set when the loan
--     is booked; a loan can be booked once (unbook reverses it).

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS liability_account_code    text,
  ADD COLUMN IF NOT EXISTS finance_cost_account_code text,
  ADD COLUMN IF NOT EXISTS cash_account_code         text,
  ADD COLUMN IF NOT EXISTS booking_mode              text,   -- 'disbursement' | 'opening_balance'
  ADD COLUMN IF NOT EXISTS booking_journal_entry_id  uuid,
  ADD COLUMN IF NOT EXISTS booked_at                 timestamptz;
