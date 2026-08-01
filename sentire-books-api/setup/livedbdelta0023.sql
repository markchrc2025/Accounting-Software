-- ════════════════════════════════════════════════════════════════════════════
-- Account-code collisions + the AR tax accounts (M2.0).
-- ════════════════════════════════════════════════════════════════════════════
-- RUN THIS AS THE DATABASE OWNER (pgAdmin / psql as the owner role) BEFORE the
-- API redeploys with M2.0 or later.
--
-- WHY IT IS NEEDED
-- The default chart shipped three account codes twice each — once as equity,
-- once as an "Other Current Liability":
--
--     2004001  Owner's Equity          / Salaries and Wages Payable
--     2004002  Opening Balance Offset  / Final Pay Payable Deployed
--     2004003  Retained Earnings       / Final Pay Payable
--
-- Posting code resolves accounts BY CODE, so a duplicate was ambiguous, and
-- `OPENING_EQUITY_DEFAULT` is literally 2004002 — an opening-balance loan or
-- fixed-asset booking could debit the payroll liability instead of equity. The
-- entry balanced, so no ledger invariant fired: a silent balance-sheet
-- misstatement.
--
-- SAFE IF THIS DELTA IS MISSED: the M2.0 API fails CLOSED. Any booking that
-- touches a duplicated code returns HTTP 409 naming both candidate accounts
-- instead of guessing. Nothing mis-posts — the affected bookings simply refuse
-- until this runs. Run it anyway; a 409 on a legitimate booking is an outage of
-- one workflow.
--
-- Idempotent and additive: safe to re-run. Wrapped in a transaction.

BEGIN;

-- ── 1. Renumber the payroll liabilities out of the equity block ─────────────
-- Matched on name + type + current code, so only genuinely colliding rows move.
-- Equity KEEPS 2004001-3. The liabilities go to the free 2005xxx range, beside
-- the other employee-liability groups (2008 Social Agency Contribution,
-- 2009 Employee Benefit Claims).
UPDATE accounts SET code = '2005001'
 WHERE name = 'Salaries and Wages Payable' AND type = 'liability' AND code = '2004001';
UPDATE accounts SET code = '2005002'
 WHERE name = 'Final Pay Payable Deployed' AND type = 'liability' AND code = '2004002';
UPDATE accounts SET code = '2005003'
 WHERE name = 'Final Pay Payable'          AND type = 'liability' AND code = '2004003';

-- ── 2. Add the two accounts Milestone 2 needs ───────────────────────────────
--   1009002 Creditable Withholding Tax — the ASSET for EWT clients withhold
--           from us (BIR 2307), creditable against income tax. NOT the same as
--           2101 Expanded Withholding Tax Payable, which is its mirror image:
--           tax WE withhold FROM vendors and owe the BIR.
--   2003004 Percentage Tax Payable — Sec. 116, for non-VAT tenants.
-- Left parentless to match their siblings (1009001, 2003001-3 all have
-- parent_id IS NULL even though 2003 "Tax Payable" exists).
INSERT INTO accounts (org_id, code, name, type, subtype, description, normal_balance, is_active)
SELECT o.id, v.code, v.name, v.type::account_type, v.subtype, v.description, v.normal_balance, true
FROM organizations o
CROSS JOIN (VALUES
  ('1009002', 'Creditable Withholding Tax', 'asset',     'Tax Asset',     'debit',
   'Expanded withholding tax withheld by clients on our income payments (BIR Form 2307), creditable against income tax due.'),
  ('2003004', 'Percentage Tax Payable',     'liability', 'Tax Liability', 'credit',
   'Percentage tax due under Sec. 116 for non-VAT registered taxpayers.')
) AS v(code, name, type, subtype, normal_balance, description)
ON CONFLICT (org_id, name) DO NOTHING;

COMMIT;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Expect ZERO rows — no duplicate codes remain:
--   SELECT code, count(*), string_agg(name || ' [' || type || ']', ' | ')
--     FROM accounts GROUP BY org_id, code HAVING count(*) > 1;
--
-- Expect the renumbered trio and the two new accounts:
--   SELECT code, name, type FROM accounts
--    WHERE code IN ('2004001','2004002','2004003','2005001','2005002','2005003','1009002','2003004')
--    ORDER BY code;
--
-- ── AFTERWARDS (still owed, blocked on your query output) ───────────────────
-- Check whether any ALREADY-BOOKED loan or asset entry hit the wrong side of a
-- collision before this delta ran. Those need a correcting REVERSAL (never an
-- update — the ledger is append-only):
--
--   SELECT je.entry_no, je.entry_date, je.memo, a.code, a.name, a.type,
--          jl.debit_cents, jl.credit_cents
--     FROM journal_entries je
--     JOIN journal_lines  jl ON jl.entry_id = je.id
--     JOIN accounts       a  ON a.id = jl.account_id
--    WHERE je.source_type IN ('loan','fixed_asset')
--      AND a.name IN ('Salaries and Wages Payable','Final Pay Payable Deployed','Final Pay Payable')
--    ORDER BY je.entry_date;
--
-- Any row returned is a mis-posted line. Send the output and it will be
-- corrected by reversal.
