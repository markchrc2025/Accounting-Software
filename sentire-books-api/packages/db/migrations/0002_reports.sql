-- ════════════════════════════════════════════════════════════════════════════
-- Reporting views — trial balance & profit-and-loss source data.
-- ════════════════════════════════════════════════════════════════════════════
-- security_invoker = true so Row-Level Security on the base tables applies to the
-- querying role (the API's sentire_books_app + its org context). Requires PostgreSQL 15+.

-- One row per POSTED journal line, flattened with its entry + account metadata.
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
WHERE je.status = 'posted';

-- All-time trial balance per account (period reports filter v_account_postings
-- by entry_date in the API).
CREATE OR REPLACE VIEW v_trial_balance
WITH (security_invoker = true) AS
SELECT
  org_id,
  account_id,
  account_code,
  account_name,
  account_type,
  SUM(debit_cents)                      AS debit_cents,
  SUM(credit_cents)                     AS credit_cents,
  SUM(debit_cents) - SUM(credit_cents)  AS balance_cents
FROM v_account_postings
GROUP BY org_id, account_id, account_code, account_name, account_type;

GRANT SELECT ON v_account_postings, v_trial_balance TO sentire_books_app;
