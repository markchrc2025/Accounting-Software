/**
 * Tax registry (M2.5) — real Postgres, real routers, RLS-bound as
 * `sentire_books_app`. Skipped unless DATABASE_URL is set.
 *
 * Replaces `TaxPage.jsx`'s client-side derivation, which:
 *   • took `.slice(0, 50)` of Payment/Check vouchers — everything older
 *     silently vanished from a TAX report, and
 *   • then issued one `getVoucher()` per voucher to hydrate the lines, up to
 *     50 sequential round trips per page load.
 *
 * The truncation test below builds MORE than 50 tax-bearing vouchers on
 * purpose: under the old cap it would have been impossible to see them all.
 *
 * It also gains a sales side. Before M2.1 there was no output VAT anywhere in
 * the system, so the page could only ever show input tax from disbursements —
 * half a VAT position.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq, inArray, sql } from "drizzle-orm";
import {
  withOrgContext,
  accounts,
  vouchers,
  voucherLines,
  serviceInvoices,
  DEMO_ORG_ID,
  DEMO_ADMIN_ID,
  DEMO_ADMIN_EMAIL,
} from "@sentire-books/db";
import { taxRegistryRoutes } from "../routes/taxRegistry";
import { serviceInvoiceRoutes } from "../routes/billingAr";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

const REVENUE = "3001001";
const EXPENSE = "5900000"; // Other General Expenses
const NET = 10_000_000;
const VAT = 1_200_000;

const app = new Hono();
app.route("/reports", taxRegistryRoutes);
app.route("/invoices", serviceInvoiceRoutes);

const call = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": DEMO_ADMIN_ID,
      "x-user-email": DEMO_ADMIN_EMAIL,
      "x-org-id": DEMO_ORG_ID,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

interface Registry {
  from: string | null;
  to: string | null;
  complete: boolean;
  lines: Array<{
    side: "purchase" | "sale";
    date: string;
    period: string;
    documentNo: string;
    source: string;
    taxName: string;
    taxRate: number;
    grossCents: number;
    taxCents: number;
  }>;
  totals: {
    outputTaxCents: number;
    inputTaxCents: number;
    netVatPayableCents: number;
    salesGrossCents: number;
    purchasesGrossCents: number;
  };
  byPeriod: Array<{ period: string; outputTaxCents: number; inputTaxCents: number; netVatPayableCents: number }>;
  counts: { purchases: number; sales: number };
}

async function registry(qs = ""): Promise<Registry> {
  const res = await call("GET", `/reports/tax-registry${qs}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Registry;
}

let seq = 0;
const madeVouchers: string[] = [];
const madeInvoices: string[] = [];

/** A Payment voucher with one tax-bearing line. Meta money is in PESOS. */
async function taxVoucher(date: string, taxPesos: number, grossCents = 1_000_000) {
  const [acct] = await withOrgContext(ctx, (tx) =>
    tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(sql`${accounts.orgId} = ${DEMO_ORG_ID} AND ${accounts.code} = ${EXPENSE}`),
  );
  const [v] = await withOrgContext(ctx, (tx) =>
    tx
      .insert(vouchers)
      .values({
        orgId: DEMO_ORG_ID,
        voucherNo: `PV-T${Date.now() % 1e6}-${++seq}`,
        voucherType: "payment",
        voucherDate: date,
        status: "approved",
        purposeCategory: "Supplies",
        createdBy: DEMO_ADMIN_ID,
      } as never)
      .returning(),
  );
  madeVouchers.push(v!.id);
  await withOrgContext(ctx, (tx) =>
    tx.insert(voucherLines).values({
      voucherId: v!.id,
      lineNo: 1,
      accountId: acct!.id,
      description: "Taxable purchase",
      amountCents: grossCents,
      meta: { taxAmt: taxPesos, taxType: "VAT 12%", taxRate: 12, inclusive: false, contact: "Supplier Co" },
    } as never),
  );
  return v!;
}

/** An issued VATable invoice — the sales side. */
async function vatInvoice(date: string) {
  const res = await call("POST", "/invoices", {
    siNo: `IS-T${Date.now() % 1e6}-${++seq}`,
    contactName: "Tax Client",
    siDate: date,
    amountCents: NET + VAT,
    netCents: NET,
    vatCents: VAT,
    vatTreatment: "vatable",
    incomeAccountCode: REVENUE,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const { invoice } = (await res.json()) as { invoice: { id: string; siNo: string } };
  madeInvoices.push(invoice.id);
  expect((await call("POST", `/invoices/${invoice.id}/issue`, {})).status).toBe(200);
  return invoice;
}

async function reset() {
  if (madeVouchers.length) {
    await withOrgContext(ctx, (tx) =>
      tx.delete(voucherLines).where(inArray(voucherLines.voucherId, madeVouchers)),
    );
    await withOrgContext(ctx, (tx) => tx.delete(vouchers).where(inArray(vouchers.id, madeVouchers)));
    madeVouchers.length = 0;
  }
  for (const id of madeInvoices) {
    await withOrgContext(ctx, (tx) =>
      tx.update(serviceInvoices).set({ appliedCents: 0 }).where(eq(serviceInvoices.id, id)),
    );
    await call("POST", `/invoices/${id}/cancel`, {});
    await withOrgContext(ctx, (tx) => tx.delete(serviceInvoices).where(eq(serviceInvoices.id, id)));
  }
  madeInvoices.length = 0;
}

describe.skipIf(!RUN)("M2.5 — tax registry", () => {
  const saved = { secret: process.env.AUTH_JWT_SECRET, bypass: process.env.AUTH_DEV_BYPASS };

  beforeAll(() => {
    delete process.env.AUTH_JWT_SECRET;
    process.env.AUTH_DEV_BYPASS = "true";
  });

  afterAll(async () => {
    await reset();
    if (saved.secret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = saved.secret;
    if (saved.bypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = saved.bypass;
  });

  /* ── The cap is gone ─────────────────────────────────────────────────────── */

  describe("no truncation", () => {
    it("returns ALL tax-bearing vouchers, well past the old 50 cap", async () => {
      await reset();
      const COUNT = 62; // > 50, so the old slice would have dropped 12
      for (let i = 0; i < COUNT; i++) {
        // Spread across months so truncation would also lose whole PERIODS.
        const month = String((i % 12) + 1).padStart(2, "0");
        await taxVoucher(`2025-${month}-${String((i % 28) + 1).padStart(2, "0")}`, 120);
      }

      const r = await registry();
      expect(r.counts.purchases).toBe(COUNT);
      expect(r.totals.inputTaxCents).toBe(COUNT * 12_000); // 120 pesos each
      // Every month is represented — the old cap lost the oldest periods.
      expect(new Set(r.byPeriod.map((p) => p.period)).size).toBe(12);
      expect(r.complete).toBe(true);
    });

    it("says so explicitly when a date filter narrows the coverage", async () => {
      const all = await registry();
      expect(all.complete).toBe(true);

      const narrowed = await registry("?from=2025-01-01&to=2025-03-31");
      expect(narrowed.complete).toBe(false);
      expect(narrowed.from).toBe("2025-01-01");
      expect(narrowed.lines.length).toBeLessThan(all.lines.length);
      expect(narrowed.lines.every((l) => l.date >= "2025-01-01" && l.date <= "2025-03-31")).toBe(true);
    });
  });

  /* ── The sales side, which did not exist before M2.1 ─────────────────────── */

  describe("output VAT from issued invoices", () => {
    it("surfaces output tax as a sale line", async () => {
      await reset();
      const inv = await vatInvoice("2026-02-14");

      const r = await registry();
      expect(r.counts.sales).toBe(1);
      const line = r.lines.find((l) => l.documentNo === inv.siNo)!;
      expect(line.side).toBe("sale");
      expect(line.source).toBe("Service Invoice");
      expect(line.taxName).toBe("Output VAT");
      expect(line.taxCents).toBe(VAT);
      expect(line.grossCents).toBe(NET); // the VAT base
      expect(line.taxRate).toBe(12); // derived from the amounts, not stored
      expect(r.totals.outputTaxCents).toBe(VAT);
      expect(r.totals.salesGrossCents).toBe(NET);
    });

    it("computes the net VAT position — output less creditable input", async () => {
      await reset();
      await vatInvoice("2026-02-14"); // output 1,200,000
      await taxVoucher("2026-02-20", 4_000); // input   400,000

      const r = await registry();
      expect(r.totals.outputTaxCents).toBe(1_200_000);
      expect(r.totals.inputTaxCents).toBe(400_000);
      expect(r.totals.netVatPayableCents).toBe(800_000);
    });

    it("reports a negative net position as an input-tax credit", async () => {
      await reset();
      await taxVoucher("2026-03-05", 9_000); // 900,000 input, no sales

      const r = await registry();
      expect(r.totals.outputTaxCents).toBe(0);
      expect(r.totals.netVatPayableCents).toBe(-900_000);
    });

    it("excludes DRAFT invoices — no output VAT has accrued yet", async () => {
      await reset();
      const res = await call("POST", "/invoices", {
        siNo: `IS-TD${Date.now() % 1e6}`,
        contactName: "Draft Client",
        siDate: "2026-02-14",
        amountCents: NET + VAT,
        netCents: NET,
        vatCents: VAT,
        vatTreatment: "vatable",
        incomeAccountCode: REVENUE,
      });
      const { invoice } = (await res.json()) as { invoice: { id: string } };
      madeInvoices.push(invoice.id);

      const r = await registry();
      expect(r.counts.sales).toBe(0);
      expect(r.totals.outputTaxCents).toBe(0);
    });

    it("excludes a cancelled invoice", async () => {
      await reset();
      const inv = await vatInvoice("2026-02-14");
      expect((await registry()).totals.outputTaxCents).toBe(VAT);

      const row = await withOrgContext(ctx, (tx) =>
        tx.select().from(serviceInvoices).where(eq(serviceInvoices.siNo, inv.siNo)),
      );
      expect((await call("POST", `/invoices/${row[0]!.id}/cancel`, {})).status).toBe(200);
      expect((await registry()).totals.outputTaxCents).toBe(0);
    });

    it("omits a non-VAT invoice — there is no output tax to report", async () => {
      await reset();
      const res = await call("POST", "/invoices", {
        siNo: `IS-TN${Date.now() % 1e6}`,
        contactName: "NonVat Client",
        siDate: "2026-02-14",
        amountCents: NET,
        netCents: NET,
        vatCents: 0,
        vatTreatment: "none",
        incomeAccountCode: REVENUE,
      });
      const { invoice } = (await res.json()) as { invoice: { id: string } };
      madeInvoices.push(invoice.id);
      await call("POST", `/invoices/${invoice.id}/issue`, {});

      const r = await registry();
      expect(r.counts.sales).toBe(0);
    });
  });

  /* ── Purchases ───────────────────────────────────────────────────────────── */

  describe("input tax from voucher lines", () => {
    it("reads the tax picker's meta and converts pesos to centavos", async () => {
      await reset();
      const v = await taxVoucher("2026-01-15", 1_200, 1_000_000);

      const r = await registry();
      const line = r.lines.find((l) => l.documentNo === v.voucherNo)!;
      expect(line.side).toBe("purchase");
      expect(line.source).toBe("Payment Voucher");
      expect(line.taxName).toBe("VAT 12%");
      expect(line.taxRate).toBe(12);
      expect(line.taxCents).toBe(120_000); // 1,200 pesos → centavos
      expect(line.grossCents).toBe(1_000_000);
    });

    it("skips voucher lines that carry no tax", async () => {
      await reset();
      await taxVoucher("2026-01-15", 0);
      const r = await registry();
      expect(r.counts.purchases).toBe(0);
    });

    it("skips draft and voided vouchers", async () => {
      await reset();
      const v = await taxVoucher("2026-01-15", 1_200);
      expect((await registry()).counts.purchases).toBe(1);

      for (const status of ["draft", "void"] as const) {
        await withOrgContext(ctx, (tx) =>
          tx.update(vouchers).set({ status }).where(eq(vouchers.id, v.id)),
        );
        expect((await registry()).counts.purchases, status).toBe(0);
      }
    });
  });

  /* ── Aggregation ─────────────────────────────────────────────────────────── */

  describe("period aggregation", () => {
    it("groups both sides by period, newest first", async () => {
      await reset();
      await vatInvoice("2026-01-10");
      await taxVoucher("2026-01-20", 3_000);
      await vatInvoice("2026-02-10");

      const r = await registry();
      expect(r.byPeriod.map((p) => p.period)).toEqual(["2026-02", "2026-01"]);

      const jan = r.byPeriod.find((p) => p.period === "2026-01")!;
      expect(jan.outputTaxCents).toBe(VAT);
      expect(jan.inputTaxCents).toBe(300_000);
      expect(jan.netVatPayableCents).toBe(VAT - 300_000);

      const feb = r.byPeriod.find((p) => p.period === "2026-02")!;
      expect(feb.outputTaxCents).toBe(VAT);
      expect(feb.inputTaxCents).toBe(0);
    });

    it("period totals sum to the grand totals", async () => {
      const r = await registry();
      expect(r.byPeriod.reduce((s, p) => s + p.outputTaxCents, 0)).toBe(r.totals.outputTaxCents);
      expect(r.byPeriod.reduce((s, p) => s + p.inputTaxCents, 0)).toBe(r.totals.inputTaxCents);
    });

    it("sorts lines newest first", async () => {
      const r = await registry();
      const dates = r.lines.map((l) => l.date);
      expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
    });
  });

  /* ── Validation ──────────────────────────────────────────────────────────── */

  describe("the endpoint", () => {
    it("400s a malformed date rather than silently ignoring it", async () => {
      for (const qs of ["?from=01-2026", "?to=2026/01/01"]) {
        const res = await call("GET", `/reports/tax-registry${qs}`);
        expect(res.status, qs).toBe(400);
      }
    });

    it("400s an inverted range", async () => {
      const res = await call("GET", "/reports/tax-registry?from=2026-06-01&to=2026-01-01");
      expect(res.status).toBe(400);
      expect(((await res.json()) as { detail?: string }).detail).toContain("after");
    });
  });
});
