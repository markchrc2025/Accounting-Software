import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { netProfit, type AccountType } from "@scalebooks/domain";
import { withOrgContext } from "@scalebooks/db";
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
