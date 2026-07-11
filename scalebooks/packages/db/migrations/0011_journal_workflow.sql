-- ════════════════════════════════════════════════════════════════════════════
-- Journal maker-checker workflow + entry classification.
-- ════════════════════════════════════════════════════════════════════════════
-- The portal drives entries through a review workflow before they hit the
-- ledger: Draft → Pending Review → Pending Approval → For Clearing → Cleared →
-- For Posting → Posted (plus Rejected/Voided, and Reversed after posting).
-- The enum grows to carry those states; every pre-posted state behaves like
-- 'draft' to the integrity triggers (mutable, balance not yet enforced), and
-- 'posted' keeps its append-only, must-balance semantics unchanged.
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'pending_approval';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'for_clearing';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'cleared';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'for_posting';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'rejected';
ALTER TYPE entry_status ADD VALUE IF NOT EXISTS 'voided';

-- Classification (Manual/Adjusting/Accrual/Closing/Reversing), a free-text
-- reference, and the accrual auto-reversal back-link.
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS entry_type          text NOT NULL DEFAULT 'Manual',
  ADD COLUMN IF NOT EXISTS reference           text,
  ADD COLUMN IF NOT EXISTS accrual_reversal_of uuid REFERENCES journal_entries(id);

-- ── Report-correctness fix ────────────────────────────────────────────────────
-- v_account_postings counted only status='posted'. Reversing an entry flips the
-- ORIGINAL to 'reversed', which silently removed its postings from reports while
-- the offsetting reversal stayed — reports showed a net NEGATIVE instead of zero.
-- A reversed entry's postings still happened; the reversal offsets them. Include
-- both. (Workflow states remain excluded — they haven't reached the ledger.)
CREATE OR REPLACE VIEW v_account_postings
WITH (security_invoker = true) AS
SELECT
  je.org_id,
  je.id           AS entry_id,
  je.entry_date,
  a.id            AS account_id,
  a.code          AS account_code,
  a.name          AS account_name,
  a.type          AS account_type,
  jl.debit_cents,
  jl.credit_cents
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id
JOIN accounts        a  ON a.id  = jl.account_id
WHERE je.status IN ('posted', 'reversed');
