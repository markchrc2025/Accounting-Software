-- ════════════════════════════════════════════════════════════════════════════
-- Loans column catch-up (fixes GET /loans and /loans/reconciliation → 500).
-- ════════════════════════════════════════════════════════════════════════════
-- The API was deployed with the newer schema (loan control numbers + GL
-- integration columns) before these columns were added to the live database, so
-- SELECT … FROM loans references columns that don't exist yet → 500. This script
-- brings the live `loans` table up to what the API expects.
--
-- Idempotent and safe to re-run: every column uses ADD COLUMN IF NOT EXISTS, the
-- loan_no backfill only touches rows still missing a number, and the counter /
-- index upserts are conflict-safe. Combines deltas 0019 + 0020.

-- ── 0019: loan control number (loan_no = LN{YYYYMM}-####) ────────────────────
ALTER TABLE loans ADD COLUMN IF NOT EXISTS loan_no text;

-- Backfill any loans still without a number, per org, per disbursement-month.
WITH numbered AS (
  SELECT id,
    'LN' || to_char(COALESCE(disbursement_date, created_at::date), 'YYYYMM') AS period_key,
    row_number() OVER (
      PARTITION BY org_id, to_char(COALESCE(disbursement_date, created_at::date), 'YYYYMM')
      ORDER BY created_at, id
    ) AS seq
  FROM loans WHERE loan_no IS NULL
)
UPDATE loans l
   SET loan_no = n.period_key || '-' || lpad(n.seq::text, 4, '0')
  FROM numbered n
 WHERE l.id = n.id;

-- Advance the shared counter so the API's next number continues the sequence.
INSERT INTO document_counters (org_id, period_key, seq)
SELECT org_id,
       'LN' || to_char(COALESCE(disbursement_date, created_at::date), 'YYYYMM') AS period_key,
       count(*) AS seq
  FROM loans
 WHERE loan_no IS NOT NULL
 GROUP BY org_id, 'LN' || to_char(COALESCE(disbursement_date, created_at::date), 'YYYYMM')
ON CONFLICT (org_id, period_key)
DO UPDATE SET seq = GREATEST(document_counters.seq, EXCLUDED.seq);

CREATE UNIQUE INDEX IF NOT EXISTS loans_org_no_key ON loans (org_id, loan_no);

-- ── 0020: loan → GL integration columns ─────────────────────────────────────
ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS liability_account_code    text,
  ADD COLUMN IF NOT EXISTS finance_cost_account_code text,
  ADD COLUMN IF NOT EXISTS cash_account_code         text,
  ADD COLUMN IF NOT EXISTS booking_mode              text,   -- 'disbursement' | 'opening_balance'
  ADD COLUMN IF NOT EXISTS booking_journal_entry_id  uuid,
  ADD COLUMN IF NOT EXISTS booked_at                 timestamptz;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- Expect: loan_columns = 7 and loans_without_number = 0.
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'loans'
       AND column_name IN (
         'loan_no', 'liability_account_code', 'finance_cost_account_code',
         'cash_account_code', 'booking_mode', 'booking_journal_entry_id', 'booked_at'
       )) AS loan_columns,
  (SELECT count(*) FROM loans WHERE loan_no IS NULL) AS loans_without_number;
