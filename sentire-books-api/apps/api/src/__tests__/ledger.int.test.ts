/**
 * Integration tests — exercise the real Postgres triggers, RLS, and report views.
 * Skipped unless DATABASE_URL is set (CI provides a Postgres service + seed).
 * Run as the `sentire_books_app` role so RLS is actually enforced.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { sql, eq, inArray } from "drizzle-orm";
import {
  db,
  withOrgContext,
  accounts,
  journalEntries,
  journalLines,
  DEMO_ORG_ID,
  DEMO_ADMIN_ID,
} from "@sentire-books/db";
import { postJournalEntry } from "../ledger/postJournalEntry";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

describe.skipIf(!RUN)("ledger integration (Postgres)", () => {
  let cashId = "";
  let revenueId = "";

  beforeAll(async () => {
    const rows = await withOrgContext(ctx, (tx) =>
      tx.select().from(accounts).where(inArray(accounts.code, ["1001640", "3001001"])),
    );
    cashId = rows.find((r) => r.code === "1001640")!.id; // Cash in Bank - UB Savings
    revenueId = rows.find((r) => r.code === "3001001")!.id; // Manpower Service Revenue
  });

  it("posts a balanced entry, recorded as posted", async () => {
    const res = await postJournalEntry(
      {
        orgId: DEMO_ORG_ID,
        entryDate: "2026-06-16",
        memo: "integration: balanced",
        lines: [
          { accountId: cashId, debitCents: 100_000, creditCents: 0 },
          { accountId: revenueId, debitCents: 0, creditCents: 100_000 },
        ],
      },
      ctx,
    );
    expect(res.entryNo).toMatch(/^JE2026/);

    const [row] = await withOrgContext(ctx, (tx) =>
      tx.select().from(journalEntries).where(eq(journalEntries.id, res.id)),
    );
    expect(row?.status).toBe("posted");
  });

  it("DB trigger rejects an unbalanced posted entry", async () => {
    const attempt = withOrgContext(ctx, async (tx) => {
      const [e] = await tx
        .insert(journalEntries)
        .values({
          orgId: DEMO_ORG_ID,
          entryNo: `INT-UNBAL-${Date.now()}`,
          entryDate: "2026-06-16",
          status: "draft",
          createdBy: DEMO_ADMIN_ID,
        })
        .returning({ id: journalEntries.id });
      await tx.insert(journalLines).values({
        entryId: e!.id,
        lineNo: 1,
        accountId: cashId,
        debitCents: 100_000,
        creditCents: 0, // one-sided → must fail at COMMIT
      });
      await tx.update(journalEntries).set({ status: "posted" }).where(eq(journalEntries.id, e!.id));
    });
    await expect(attempt).rejects.toThrow();
  });

  it("posted entries cannot be deleted (append-only)", async () => {
    const res = await postJournalEntry(
      {
        orgId: DEMO_ORG_ID,
        entryDate: "2026-06-16",
        memo: "integration: immutable",
        lines: [
          { accountId: cashId, debitCents: 5_000, creditCents: 0 },
          { accountId: revenueId, debitCents: 0, creditCents: 5_000 },
        ],
      },
      ctx,
    );
    const del = withOrgContext(ctx, (tx) =>
      tx.delete(journalEntries).where(eq(journalEntries.id, res.id)),
    );
    await expect(del).rejects.toThrow();
  });

  it("RLS isolates entries by organization", async () => {
    const otherOrg = "00000000-0000-0000-0000-0000000000ff";
    const otherRows = await withOrgContext({ userId: DEMO_ADMIN_ID, orgId: otherOrg }, (tx) =>
      tx.select().from(journalEntries),
    );
    expect(otherRows).toHaveLength(0);

    // No org context at all → RLS denies everything.
    const noContext = await db.select().from(journalEntries);
    expect(noContext).toHaveLength(0);
  });

  it("trial balance is always balanced; a posting moves P&L by its amount", async () => {
    const date = "2099-01-01";
    const incomeForDate = async () => {
      const r = (await withOrgContext(ctx, (tx) =>
        tx.execute(sql`
          SELECT COALESCE(SUM(credit_cents - debit_cents), 0)::bigint AS income
          FROM v_account_postings
          WHERE account_type = 'income' AND entry_date = ${date}::date`),
      )) as unknown as Array<{ income: string }>;
      return Number(r[0]!.income);
    };

    // Delta-based so the assertion is robust to data left by prior runs.
    const before = await incomeForDate();
    await postJournalEntry(
      {
        orgId: DEMO_ORG_ID,
        entryDate: date,
        memo: "integration: pnl",
        lines: [
          { accountId: cashId, debitCents: 250_000, creditCents: 0 },
          { accountId: revenueId, debitCents: 0, creditCents: 250_000 },
        ],
      },
      ctx,
    );
    const after = await incomeForDate();
    expect(after - before).toBe(250_000);

    const tb = (await withOrgContext(ctx, (tx) =>
      tx.execute(sql`
        SELECT COALESCE(SUM(debit_cents), 0)::bigint AS d,
               COALESCE(SUM(credit_cents), 0)::bigint AS c
        FROM v_account_postings`),
    )) as unknown as Array<{ d: string; c: string }>;
    expect(Number(tb[0]!.d)).toBe(Number(tb[0]!.c)); // debits == credits, always
  });
});
