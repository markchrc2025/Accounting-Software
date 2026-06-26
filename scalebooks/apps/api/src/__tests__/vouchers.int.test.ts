/**
 * Voucher integration tests — atomic voucher + journal entry against real Postgres.
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { sql, eq, inArray } from "drizzle-orm";
import {
  withOrgContext,
  accounts,
  vouchers,
  journalEntries,
  DEMO_ORG_ID,
  DEMO_ADMIN_ID,
} from "@scalebooks/db";
import { createVoucher } from "../ledger/createVoucher";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

describe.skipIf(!RUN)("voucher integration (Postgres)", () => {
  let cashId = "";
  let expenseId = "";

  beforeAll(async () => {
    const rows = await withOrgContext(ctx, (tx) =>
      tx.select().from(accounts).where(inArray(accounts.code, ["1001640", "5001001"])),
    );
    cashId = rows.find((r) => r.code === "1001640")!.id; // Cash in Bank - UB Savings
    expenseId = rows.find((r) => r.code === "5001001")!.id; // Salaries and Wages
  });

  it("creates a payment voucher and atomically posts a balanced JE", async () => {
    const res = await createVoucher(
      {
        type: "payment",
        voucherDate: "2026-06-16",
        memo: "integration: rent payment",
        cashAccountId: cashId,
        lines: [{ accountId: expenseId, amountCents: 1_200_000, description: "June rent" }],
      },
      ctx,
    );
    expect(res.voucherNo).toMatch(/^PV2026/);
    expect(res.entryNo).toMatch(/^JE2026/);

    // voucher is posted and linked to the JE
    const [v] = await withOrgContext(ctx, (tx) =>
      tx.select().from(vouchers).where(eq(vouchers.id, res.id)),
    );
    expect(v?.status).toBe("posted");
    expect(v?.journalEntryId).toBe(res.journalEntryId);
    expect(v?.totalCents).toBe(1_200_000);

    // the JE is posted and points back at the voucher
    const [je] = await withOrgContext(ctx, (tx) =>
      tx.select().from(journalEntries).where(eq(journalEntries.id, res.journalEntryId)),
    );
    expect(je?.status).toBe("posted");
    expect(je?.sourceType).toBe("voucher");
    expect(je?.sourceId).toBe(res.id);
  });

  it("keeps the trial balance balanced after voucher posting", async () => {
    const tb = (await withOrgContext(ctx, (tx) =>
      tx.execute(sql`
        SELECT COALESCE(SUM(debit_cents),0)::bigint AS d,
               COALESCE(SUM(credit_cents),0)::bigint AS c
        FROM v_account_postings`),
    )) as unknown as Array<{ d: string; c: string }>;
    expect(Number(tb[0]!.d)).toBe(Number(tb[0]!.c));
  });
});
