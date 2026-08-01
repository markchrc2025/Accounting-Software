-- ════════════════════════════════════════════════════════════════════════════
-- Ledger invariant verification (M1.2)
-- ════════════════════════════════════════════════════════════════════════════
-- Run against a RESTORED database to prove the books survived the restore.
-- Checks the non-negotiable invariants from CLAUDE.md, not merely that rows
-- came back: a restore that returns data but breaks double-entry is a failure.
--
--   psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -f verify-ledger.sql
--
-- Every check RAISES EXCEPTION on failure, so psql exits non-zero. Silence and
-- a final "ALL LEDGER INVARIANTS HOLD" is the only success.

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_debits      bigint;
  v_credits     bigint;
  v_unbalanced  bigint;
  v_zero        bigint;
  v_bad_side    bigint;
  v_triggers    int;
  v_views       int;
  v_rls_tables  int;
  v_no_policy   text;
  v_dupe_no     text;
  v_entries     bigint;
  v_accounts    bigint;
BEGIN
  -- ── 1. The trial balance balances, to the centavo ───────────────────────
  SELECT COALESCE(SUM(debit_cents), 0), COALESCE(SUM(credit_cents), 0)
    INTO v_debits, v_credits
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
   WHERE je.status IN ('posted', 'reversed');

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION 'INVARIANT 1 FAILED: trial balance does not balance — debits % <> credits % (difference % centavos)',
      v_debits, v_credits, v_debits - v_credits;
  END IF;
  RAISE NOTICE 'OK  1. Trial balance balances: % centavos on each side', v_debits;

  -- ── 2. EVERY posted entry balances individually ─────────────────────────
  SELECT count(*) INTO v_unbalanced FROM (
    SELECT jl.entry_id
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.status IN ('posted', 'reversed')
     GROUP BY jl.entry_id
    HAVING SUM(jl.debit_cents) <> SUM(jl.credit_cents)
  ) bad;

  IF v_unbalanced > 0 THEN
    RAISE EXCEPTION 'INVARIANT 2 FAILED: % posted entr(ies) do not balance individually', v_unbalanced;
  END IF;
  RAISE NOTICE 'OK  2. Every posted entry balances individually';

  -- ── 3. No posted entry is zero-valued ───────────────────────────────────
  SELECT count(*) INTO v_zero FROM (
    SELECT jl.entry_id
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
     WHERE je.status IN ('posted', 'reversed')
     GROUP BY jl.entry_id
    HAVING SUM(jl.debit_cents) = 0
  ) z;

  IF v_zero > 0 THEN
    RAISE EXCEPTION 'INVARIANT 3 FAILED: % posted entr(ies) have a zero total', v_zero;
  END IF;
  RAISE NOTICE 'OK  3. No posted entry is zero-valued';

  -- ── 4. Line-level sanity: exactly one side per line ─────────────────────
  SELECT count(*) INTO v_bad_side
    FROM journal_lines
   WHERE (debit_cents <> 0 AND credit_cents <> 0)
      OR (debit_cents = 0 AND credit_cents = 0)
      OR debit_cents < 0 OR credit_cents < 0;

  IF v_bad_side > 0 THEN
    RAISE EXCEPTION 'INVARIANT 4 FAILED: % line(s) violate one-side-only / non-negative', v_bad_side;
  END IF;
  RAISE NOTICE 'OK  4. All lines are one-sided and non-negative';

  -- ── 5. Append-only + balance triggers survived the restore ──────────────
  SELECT count(*) INTO v_triggers
    FROM pg_trigger
   WHERE NOT tgisinternal
     AND tgname IN ('trg_lines_balanced', 'trg_entry_balanced_on_post',
                    'trg_entry_immutable', 'trg_line_immutable');

  IF v_triggers < 4 THEN
    RAISE EXCEPTION 'INVARIANT 5 FAILED: only %/4 ledger triggers present — the database is no longer self-defending', v_triggers;
  END IF;
  RAISE NOTICE 'OK  5. All 4 ledger triggers present (balance + immutability)';

  -- ── 6. Reporting views survived ─────────────────────────────────────────
  SELECT count(*) INTO v_views
    FROM pg_views
   WHERE schemaname = 'public' AND viewname IN ('v_account_postings', 'v_trial_balance');

  IF v_views < 2 THEN
    RAISE EXCEPTION 'INVARIANT 6 FAILED: only %/2 reporting views present', v_views;
  END IF;
  RAISE NOTICE 'OK  6. Reporting views present';

  -- ── 7. RLS is still enabled on EVERY org-scoped table ───────────────────
  -- Keyed on the presence of an org_id column rather than a table count: a
  -- threshold would pass while one tenant table quietly lost its RLS, which is
  -- exactly the cross-tenant leak this check exists to catch. Self-maintaining
  -- as new org-scoped tables are added.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_no_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND NOT c.relrowsecurity
     AND EXISTS (
       SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'org_id'
     );

  IF v_no_policy IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANT 7 FAILED: org-scoped table(s) WITHOUT Row-Level Security: % — tenant isolation is broken', v_no_policy;
  END IF;

  SELECT count(*) INTO v_rls_tables
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;
  RAISE NOTICE 'OK  7. RLS enabled on every org-scoped table (% total with RLS)', v_rls_tables;

  -- Any RLS-enabled table without a policy would deny everything (or, worse,
  -- signal a half-restored security model).
  SELECT string_agg(c.relname, ', ') INTO v_no_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid);

  IF v_no_policy IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANT 7 FAILED: RLS enabled but NO policy on: %', v_no_policy;
  END IF;
  RAISE NOTICE 'OK  7b. Every RLS table has at least one policy';

  -- ── 8. No duplicate document numbers within an org ──────────────────────
  SELECT string_agg(t, ', ') INTO v_dupe_no FROM (
    SELECT 'journal_entries:' || entry_no AS t
      FROM journal_entries GROUP BY org_id, entry_no HAVING count(*) > 1
    UNION ALL
    SELECT 'vouchers:' || voucher_no
      FROM vouchers GROUP BY org_id, voucher_no HAVING count(*) > 1
  ) d;

  IF v_dupe_no IS NOT NULL THEN
    RAISE EXCEPTION 'INVARIANT 8 FAILED: duplicate document numbers: %', v_dupe_no;
  END IF;
  RAISE NOTICE 'OK  8. No duplicate document numbers';

  -- ── 9. The data actually came back ──────────────────────────────────────
  SELECT count(*) INTO v_accounts FROM accounts;
  SELECT count(*) INTO v_entries  FROM journal_entries;

  IF v_accounts = 0 THEN
    RAISE EXCEPTION 'INVARIANT 9 FAILED: the chart of accounts is EMPTY — this restore contains no data';
  END IF;
  RAISE NOTICE 'OK  9. Data present: % accounts, % journal entries', v_accounts, v_entries;

  RAISE NOTICE '';
  RAISE NOTICE '✅ ALL LEDGER INVARIANTS HOLD — this restore is trustworthy.';
END $$;
