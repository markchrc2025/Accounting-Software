import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { netProfit, type AccountType } from "@sentire-books/domain";
import { withOrgContext } from "@sentire-books/db";
import { requireAuth } from "../auth";

export const reportRoutes = new Hono();

reportRoutes.use("*", requireAuth);

// Trial balance, optionally for a date range (?from=YYYY-MM-DD&to=YYYY-MM-DD).
reportRoutes.get("/trial-balance", async (c) => {
  const auth = c.get("auth");
  const from = c.req.query("from") ?? null;
  const to = c.req.query("to") ?? null;

  const rows = (await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx.execute(sql`
        SELECT account_code, account_name, account_type,
               COALESCE(SUM(debit_cents), 0)::bigint  AS debit_cents,
               COALESCE(SUM(credit_cents), 0)::bigint AS credit_cents
        FROM v_account_postings
        WHERE (${from}::date IS NULL OR entry_date >= ${from}::date)
          AND (${to}::date   IS NULL OR entry_date <= ${to}::date)
        GROUP BY account_code, account_name, account_type
        ORDER BY account_code
      `),
  )) as unknown as Array<{
    account_code: string;
    account_name: string;
    account_type: AccountType;
    debit_cents: string;
    credit_cents: string;
  }>;

  const mapped = rows.map((r) => {
    const debitCents = Number(r.debit_cents);
    const creditCents = Number(r.credit_cents);
    return {
      accountCode: r.account_code,
      accountName: r.account_name,
      accountType: r.account_type,
      debitCents,
      creditCents,
      balanceCents: debitCents - creditCents,
    };
  });

  const totals = mapped.reduce(
    (acc, r) => ({
      debitCents: acc.debitCents + r.debitCents,
      creditCents: acc.creditCents + r.creditCents,
    }),
    { debitCents: 0, creditCents: 0 },
  );

  return c.json({
    from,
    to,
    rows: mapped,
    totals,
    balanced: totals.debitCents === totals.creditCents,
  });
});

// General ledger for a period: per-account groups with opening balance, each
// posting (running balance), and closing totals.
reportRoutes.get("/general-ledger", async (c) => {
  const auth = c.get("auth");
  const from = c.req.query("from") ?? null;
  const to = c.req.query("to") ?? null;

  const result = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    async (tx) => {
      // Opening balances: everything posted before `from` (zero when no from).
      const opening = (await tx.execute(sql`
        SELECT account_id,
               COALESCE(SUM(debit_cents - credit_cents), 0)::bigint AS opening_cents
        FROM v_account_postings
        WHERE ${from}::date IS NOT NULL AND entry_date < ${from}::date
        GROUP BY account_id
      `)) as unknown as Array<{ account_id: string; opening_cents: string }>;
      const openingBy = new Map(opening.map((o) => [o.account_id, Number(o.opening_cents)]));

      const lines = (await tx.execute(sql`
        SELECT p.account_id, p.account_code, p.account_name, p.account_type,
               p.entry_date, p.debit_cents, p.credit_cents,
               je.entry_no, je.memo
        FROM v_account_postings p
        JOIN journal_entries je ON je.id = p.entry_id
        WHERE (${from}::date IS NULL OR p.entry_date >= ${from}::date)
          AND (${to}::date   IS NULL OR p.entry_date <= ${to}::date)
        ORDER BY p.account_code, p.entry_date, je.entry_no
      `)) as unknown as Array<{
        account_id: string;
        account_code: string;
        account_name: string;
        account_type: string;
        entry_date: string;
        debit_cents: string;
        credit_cents: string;
        entry_no: string;
        memo: string | null;
      }>;

      const groups = new Map<
        string,
        {
          accountId: string;
          accountCode: string;
          accountName: string;
          accountType: string;
          openingCents: number;
          lines: Array<{
            date: string;
            entryNo: string;
            description: string;
            debitCents: number;
            creditCents: number;
            balanceCents: number;
          }>;
          totalDebitCents: number;
          totalCreditCents: number;
          closingCents: number;
        }
      >();
      for (const l of lines) {
        let g = groups.get(l.account_id);
        if (!g) {
          const openingCents = openingBy.get(l.account_id) ?? 0;
          g = {
            accountId: l.account_id,
            accountCode: l.account_code,
            accountName: l.account_name,
            accountType: l.account_type,
            openingCents,
            lines: [],
            totalDebitCents: 0,
            totalCreditCents: 0,
            closingCents: openingCents,
          };
          groups.set(l.account_id, g);
        }
        const debit = Number(l.debit_cents);
        const credit = Number(l.credit_cents);
        g.totalDebitCents += debit;
        g.totalCreditCents += credit;
        g.closingCents += debit - credit;
        g.lines.push({
          date: l.entry_date,
          entryNo: l.entry_no,
          description: l.memo ?? "",
          debitCents: debit,
          creditCents: credit,
          balanceCents: g.closingCents,
        });
      }
      return [...groups.values()];
    },
  );
  return c.json({ from, to, accounts: result });
});

// Income statement (account-level detail; the aggregate P&L endpoint remains).
reportRoutes.get("/income-statement", async (c) => {
  const auth = c.get("auth");
  const from = c.req.query("from") ?? null;
  const to = c.req.query("to") ?? null;

  const rows = (await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx.execute(sql`
        SELECT account_id, account_code, account_name, account_type,
               COALESCE(SUM(debit_cents), 0)::bigint  AS debit_cents,
               COALESCE(SUM(credit_cents), 0)::bigint AS credit_cents
        FROM v_account_postings
        WHERE account_type IN ('income', 'expense')
          AND (${from}::date IS NULL OR entry_date >= ${from}::date)
          AND (${to}::date   IS NULL OR entry_date <= ${to}::date)
        GROUP BY account_id, account_code, account_name, account_type
        ORDER BY account_type DESC, account_code
      `),
  )) as unknown as Array<{
    account_id: string;
    account_code: string;
    account_name: string;
    account_type: "income" | "expense";
    debit_cents: string;
    credit_cents: string;
  }>;

  const income: Array<{ accountCode: string; accountName: string; amountCents: number }> = [];
  const expenses: Array<{ accountCode: string; accountName: string; amountCents: number }> = [];
  for (const r of rows) {
    const debit = Number(r.debit_cents);
    const credit = Number(r.credit_cents);
    if (r.account_type === "income") {
      income.push({ accountCode: r.account_code, accountName: r.account_name, amountCents: credit - debit });
    } else {
      expenses.push({ accountCode: r.account_code, accountName: r.account_name, amountCents: debit - credit });
    }
  }
  const incomeCents = income.reduce((s, r) => s + r.amountCents, 0);
  const expenseCents = expenses.reduce((s, r) => s + r.amountCents, 0);
  return c.json({
    from,
    to,
    income,
    expenses,
    totals: { incomeCents, expenseCents, netProfitCents: netProfit(incomeCents, expenseCents) },
  });
});

// Balance sheet as of a date. Equity includes current earnings (income −
// expense to date) so the equation Assets = Liabilities + Equity holds.
reportRoutes.get("/balance-sheet", async (c) => {
  const auth = c.get("auth");
  const asOf = c.req.query("asOf") ?? c.req.query("to") ?? null;

  const rows = (await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx.execute(sql`
        SELECT account_id, account_code, account_name, account_type,
               COALESCE(SUM(debit_cents - credit_cents), 0)::bigint AS balance_cents
        FROM v_account_postings
        WHERE (${asOf}::date IS NULL OR entry_date <= ${asOf}::date)
        GROUP BY account_id, account_code, account_name, account_type
        ORDER BY account_code
      `),
  )) as unknown as Array<{
    account_id: string;
    account_code: string;
    account_name: string;
    account_type: string;
    balance_cents: string;
  }>;

  type BsRow = { accountCode: string; accountName: string; amountCents: number };
  const assets: BsRow[] = [];
  const liabilities: BsRow[] = [];
  const equity: BsRow[] = [];
  let earningsCents = 0;
  for (const r of rows) {
    const bal = Number(r.balance_cents); // debit-positive
    if (bal === 0) continue;
    const row = { accountCode: r.account_code, accountName: r.account_name, amountCents: bal };
    switch (r.account_type) {
      case "asset":
        assets.push(row);
        break;
      case "liability":
        liabilities.push({ ...row, amountCents: -bal }); // credit-normal
        break;
      case "equity":
        equity.push({ ...row, amountCents: -bal }); // credit-normal
        break;
      case "income":
        earningsCents += -bal;
        break;
      case "expense":
        earningsCents -= bal;
        break;
    }
  }
  if (earningsCents !== 0) {
    equity.push({ accountCode: "", accountName: "Current Earnings", amountCents: earningsCents });
  }
  const totalAssets = assets.reduce((s, r) => s + r.amountCents, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amountCents, 0);
  const totalEquity = equity.reduce((s, r) => s + r.amountCents, 0);
  return c.json({
    asOf,
    assets,
    liabilities,
    equity,
    totals: {
      assetsCents: totalAssets,
      liabilitiesCents: totalLiabilities,
      equityCents: totalEquity,
      balanced: totalAssets === totalLiabilities + totalEquity,
    },
  });
});

// Profit & loss for a period.
reportRoutes.get("/profit-and-loss", async (c) => {
  const auth = c.get("auth");
  const from = c.req.query("from") ?? null;
  const to = c.req.query("to") ?? null;

  const rows = (await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx.execute(sql`
        SELECT account_type,
               COALESCE(SUM(debit_cents), 0)::bigint  AS debit_cents,
               COALESCE(SUM(credit_cents), 0)::bigint AS credit_cents
        FROM v_account_postings
        WHERE account_type IN ('income', 'expense')
          AND (${from}::date IS NULL OR entry_date >= ${from}::date)
          AND (${to}::date   IS NULL OR entry_date <= ${to}::date)
        GROUP BY account_type
      `),
  )) as unknown as Array<{
    account_type: "income" | "expense";
    debit_cents: string;
    credit_cents: string;
  }>;

  let incomeCents = 0;
  let expenseCents = 0;
  for (const r of rows) {
    const debit = Number(r.debit_cents);
    const credit = Number(r.credit_cents);
    if (r.account_type === "income") incomeCents = credit - debit; // credit-normal
    else expenseCents = debit - credit; // debit-normal
  }

  return c.json({
    from,
    to,
    incomeCents,
    expenseCents,
    netProfitCents: netProfit(incomeCents, expenseCents),
  });
});
