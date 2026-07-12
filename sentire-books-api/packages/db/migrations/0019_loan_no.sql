-- ════════════════════════════════════════════════════════════════════════════
-- Loan control numbers.
-- ════════════════════════════════════════════════════════════════════════════
-- Loans were the one registry without an auto-assigned document number (they
-- carried only the lender name + an internal id, mirroring the legacy app).
-- Give them the same server-assigned control number as every other document:
-- LN{YYYYMM}-#### keyed to the loan's disbursement date, via document_counters.

ALTER TABLE loans ADD COLUMN IF NOT EXISTS loan_no text;

-- Backfill existing loans, per org, per disbursement-month, in creation order.
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

-- Advance the shared counter so the API's next-number continues the sequence.
INSERT INTO document_counters (org_id, period_key, seq)
SELECT org_id,
       'LN' || to_char(COALESCE(disbursement_date, created_at::date), 'YYYYMM') AS period_key,
       count(*) AS seq
  FROM loans
 WHERE loan_no IS NOT NULL
 GROUP BY org_id, 'LN' || to_char(COALESCE(disbursement_date, created_at::date), 'YYYYMM')
ON CONFLICT (org_id, period_key)
DO UPDATE SET seq = GREATEST(document_counters.seq, EXCLUDED.seq);

-- Unique per workspace going forward (NULLs are distinct, so this is safe even
-- before every row is backfilled).
CREATE UNIQUE INDEX IF NOT EXISTS loans_org_no_key ON loans (org_id, loan_no);
