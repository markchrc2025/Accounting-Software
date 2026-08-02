-- ════════════════════════════════════════════════════════════════════════════
-- Account codes: clear the default-chart collisions, add the AR tax accounts.
-- ════════════════════════════════════════════════════════════════════════════
-- Two independent changes, both idempotent, both safe to re-run:
--
-- 1. RENUMBER three payroll liabilities out of the equity block.
--    The generated default chart shipped `2004001`, `2004002` and `2004003`
--    twice each — once as equity, once as an "Other Current Liability":
--
--        2004001  Owner's Equity (equity)          / Salaries and Wages Payable
--        2004002  Opening Balance Offset (equity)  / Final Pay Payable Deployed
--        2004003  Retained Earnings (equity)       / Final Pay Payable
--
--    Account `code` is NOT unique by design (see 0005_accounts_extend.sql — the
--    unique key is `name`), so the duplicates were legal. But callers that
--    resolved a posting account BY CODE could not tell the two apart, and
--    `OPENING_EQUITY_DEFAULT` is literally `2004002` — so an opening-balance
--    loan or fixed-asset booking could debit a payroll liability instead of
--    equity. The entry balanced, so no ledger invariant fired: a silent
--    balance-sheet misstatement.
--
--    Equity keeps 2004001-3. The payroll liabilities move to the free 2005xxx
--    block, beside the other employee-liability groups (2008 Social Agency
--    Contribution, 2009 Employee Benefit Claims).
--
-- 2. ADD the two accounts Milestone 2 (Billing/AR → GL) needs, which the
--    158-account chart does not contain:
--      • 1009002 Creditable Withholding Tax — the ASSET for EWT our clients
--        withhold from us (BIR 2307), creditable against income tax. Not to be
--        confused with 2101 Expanded Withholding Tax Payable, which is the
--        mirror image: tax WE withhold FROM vendors and owe the BIR.
--      • 2003004 Percentage Tax Payable — Sec. 116, for non-VAT tenants.
--
-- NOT DONE HERE, deliberately: no UNIQUE constraint on (org_id, code). Real
-- charts legitimately reuse codes across types (the chart generator says so,
-- and tenants import their own charts through the COA import wizard), so a hard
-- constraint would reject valid data. The guard is `resolveAccountCodes()` in
-- the API, which fails closed with a 409 naming both candidates rather than
-- guessing. This migration removes the collisions we ship; the resolver handles
-- the ones a tenant creates.

-- ── 1. Renumber the payroll liabilities ─────────────────────────────────────
-- Matched on name + type + current code, so this touches only the accounts that
-- actually collide. An org that already renumbered (or never had the defaults)
-- is left alone, and re-running changes nothing.
UPDATE accounts SET code = '2005001'
 WHERE name = 'Salaries and Wages Payable'  AND type = 'liability' AND code = '2004001';
UPDATE accounts SET code = '2005002'
 WHERE name = 'Final Pay Payable Deployed'  AND type = 'liability' AND code = '2004002';
UPDATE accounts SET code = '2005003'
 WHERE name = 'Final Pay Payable'           AND type = 'liability' AND code = '2004003';

-- ── 2. Add the Milestone 2 tax accounts to every existing org ───────────────
-- Keyed on (org_id, name) — the chart's real unique key — so ON CONFLICT makes
-- this idempotent and an org that already has the account is untouched.
--
-- Left parentless on purpose: every sibling in this part of the chart is
-- (1009001 Deferred Tax Asset, 8000001 Input Tax, 2003001-3 Deferred Tax
-- Liability / Income Tax Payable / Output Tax all have parent_id IS NULL, even
-- though 2003 "Tax Payable" exists). Only the 2101xxx withholding family is
-- parented. Matching the siblings keeps the Balance Sheet grouping unchanged.
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
