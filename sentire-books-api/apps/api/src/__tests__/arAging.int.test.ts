/**
 * AR Aging (M2.4) — real Postgres, real routers, RLS-bound as
 * `sentire_books_app`. Skipped unless DATABASE_URL is set.
 *
 * The acceptance property:
 *
 *     aging total  ==  AR sub-ledger outstanding  ==  GL control (when reconciled)
 *
 * Asserted directly against the M2.3 reconciliation endpoint, because a report
 * that quietly diverges from the control account is worse than no report.
 *
 * Ages are measured from the DUE date — an invoice on Net 30 is not overdue on
 * day 1 — with boundaries checked at exactly 30/31, 60/61 and 90/91 days so no
 * invoice can land in two buckets or fall between them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  withOrgContext,
  collections,
  collectionApplications,
  serviceInvoices,
  DEMO_ORG_ID,
  DEMO_ADMIN_ID,
  DEMO_ADMIN_EMAIL,
} from "@sentire-books/db";
import { serviceInvoiceRoutes, collectionRoutes } from "../routes/billingAr";
import { daysPastDue, bucketFor, BUCKET_LABELS, AGING_BUCKETS } from "../ledger/arAging";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

const REVENUE = "3001001";
const CASH = "1001640";
const AS_OF = "2026-07-01";
const AMOUNT = 1_000_000; // PHP 10,000.00, no VAT — keeps the arithmetic obvious

const app = new Hono();
app.route("/invoices", serviceInvoiceRoutes);
app.route("/collections", collectionRoutes);

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

interface Aging {
  asOf: string;
  totals: Record<string, number> & { totalCents: number };
  rows: Array<{
    contactName: string;
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
    totalCents: number;
    invoices: Array<{ siNo: string; daysPastDue: number; bucket: string; outstandingCents: number }>;
  }>;
  invoiceCount: number;
}

async function aging(asOf = AS_OF): Promise<Aging> {
  const res = await call("GET", `/invoices/aging?asOf=${asOf}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Aging;
}

async function recon() {
  const res = await call("GET", "/collections/ar-reconciliation");
  expect(res.status).toBe(200);
  return (await res.json()) as {
    glControlCents: number;
    arSubLedgerCents: number;
    residualCents: number;
    reconciled: boolean;
  };
}

let seq = 0;
const madeInvoices: string[] = [];
const madeCollections: string[] = [];

/** An issued invoice due on `dueDate`. */
async function issued(dueDate: string, over: Record<string, unknown> = {}) {
  const res = await call("POST", "/invoices", {
    siNo: `IS-A${Date.now() % 1e6}-${++seq}`,
    contactName: "Aging Client",
    siDate: "2026-01-05",
    dueDate,
    amountCents: AMOUNT,
    netCents: AMOUNT,
    vatCents: 0,
    vatTreatment: "none",
    incomeAccountCode: REVENUE,
    ...over,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const { invoice } = (await res.json()) as { invoice: { id: string; siNo: string } };
  madeInvoices.push(invoice.id);
  expect((await call("POST", `/invoices/${invoice.id}/issue`, {})).status).toBe(200);
  return invoice;
}

async function reset() {
  for (const id of madeCollections) {
    await call("POST", `/collections/${id}/void`, {});
    await withOrgContext(ctx, (tx) =>
      tx.delete(collectionApplications).where(eq(collectionApplications.collectionId, id)),
    );
    await withOrgContext(ctx, (tx) => tx.delete(collections).where(eq(collections.id, id)));
  }
  madeCollections.length = 0;
  for (const id of madeInvoices) {
    await withOrgContext(ctx, (tx) =>
      tx.delete(collectionApplications).where(eq(collectionApplications.invoiceId, id)),
    );
    await withOrgContext(ctx, (tx) =>
      tx.update(serviceInvoices).set({ appliedCents: 0 }).where(eq(serviceInvoices.id, id)),
    );
    await call("POST", `/invoices/${id}/cancel`, {});
    await withOrgContext(ctx, (tx) => tx.delete(serviceInvoices).where(eq(serviceInvoices.id, id)));
  }
  madeInvoices.length = 0;
}

describe.skipIf(!RUN)("M2.4 — AR aging", () => {
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

  /* ── Pure bucketing logic ────────────────────────────────────────────────── */

  describe("bucket boundaries", () => {
    it("measures age from the due date", () => {
      expect(daysPastDue("2026-06-01", "2026-07-01")).toBe(30);
      expect(daysPastDue("2026-07-01", "2026-07-01")).toBe(0);
      expect(daysPastDue("2026-08-01", "2026-07-01")).toBe(-31); // not yet due
    });

    it("puts a not-yet-due invoice in Current", () => {
      expect(bucketFor(-1)).toBe("current");
      expect(bucketFor(0)).toBe("current"); // due today is not overdue
    });

    it.each([
      [1, "d1_30"],
      [30, "d1_30"],
      [31, "d31_60"],
      [60, "d31_60"],
      [61, "d61_90"],
      [90, "d61_90"],
      [91, "d90_plus"],
      [365, "d90_plus"],
    ])("day %i falls in %s", (days, bucket) => {
      expect(bucketFor(days)).toBe(bucket);
    });

    it("covers every day with exactly one bucket — no gaps, no overlaps", () => {
      for (let d = -5; d <= 400; d++) {
        const hits = AGING_BUCKETS.filter((b) => bucketFor(d) === b);
        expect(hits, `day ${d}`).toHaveLength(1);
      }
    });

    it("is DST-proof — parses dates as UTC midnight", () => {
      // Philippines has no DST, but the server's TZ is not guaranteed. A naive
      // local-time diff can come out at 29.958… and floor to 29.
      expect(daysPastDue("2026-03-01", "2026-03-31")).toBe(30);
      expect(daysPastDue("2026-10-01", "2026-10-31")).toBe(30);
    });

    it("labels every bucket", () => {
      expect(AGING_BUCKETS.map((b) => BUCKET_LABELS[b])).toEqual([
        "Current",
        "1–30",
        "31–60",
        "61–90",
        "90+",
      ]);
    });
  });

  /* ── The report ──────────────────────────────────────────────────────────── */

  describe("bucketing real invoices as of 2026-07-01", () => {
    it("places one invoice in each bucket", async () => {
      await reset();
      await issued("2026-08-01"); // -31 → Current
      await issued("2026-06-15"); //  16 → 1–30
      await issued("2026-05-20"); //  42 → 31–60
      await issued("2026-04-20"); //  72 → 61–90
      await issued("2026-01-01"); // 181 → 90+

      const a = await aging();
      expect(a.asOf).toBe(AS_OF);
      expect(a.invoiceCount).toBe(5);
      expect(a.totals.current).toBe(AMOUNT);
      expect(a.totals.d1_30).toBe(AMOUNT);
      expect(a.totals.d31_60).toBe(AMOUNT);
      expect(a.totals.d61_90).toBe(AMOUNT);
      expect(a.totals.d90_plus).toBe(AMOUNT);
      expect(a.totals.totalCents).toBe(AMOUNT * 5);
    });

    it("falls back to the invoice date when there is no due date", async () => {
      await reset();
      await issued(null as unknown as string, { dueDate: null, siDate: "2026-06-25" });
      const a = await aging();
      // 2026-06-25 → 6 days past due as of 2026-07-01.
      expect(a.totals.d1_30).toBe(AMOUNT);
      expect(a.rows[0]!.invoices[0]!.daysPastDue).toBe(6);
    });

    it("groups by customer and sorts by exposure", async () => {
      await reset();
      await issued("2026-06-15", { contactName: "Small Co" });
      await issued("2026-06-15", { contactName: "Big Co" });
      await issued("2026-05-01", { contactName: "Big Co" });

      const a = await aging();
      expect(a.rows).toHaveLength(2);
      expect(a.rows[0]!.contactName).toBe("Big Co"); // largest first
      expect(a.rows[0]!.totalCents).toBe(AMOUNT * 2);
      expect(a.rows[1]!.contactName).toBe("Small Co");
      expect(a.rows[1]!.totalCents).toBe(AMOUNT);
    });

    it("ages only the UNPAID remainder after a partial collection", async () => {
      await reset();
      const inv = await issued("2026-06-01"); // 30 days → 1–30
      const part = 400_000;
      const res = await call("POST", "/collections", {
        collectionNo: `COL-A${Date.now() % 1e6}`,
        contactName: "Aging Client",
        collectionDate: "2026-06-20",
        amountReceivedCents: part,
        ewtCents: 0,
        cashAccountCode: CASH,
      });
      const { collection: col } = (await res.json()) as { collection: { id: string } };
      madeCollections.push(col.id);
      expect(
        (
          await call("POST", `/collections/${col.id}/post`, {
            applications: [{ invoiceId: inv.id, appliedCents: part, ewtCents: 0 }],
          })
        ).status,
      ).toBe(200);

      const a = await aging();
      expect(a.totals.d1_30).toBe(AMOUNT - part); // 600,000
      expect(a.totals.totalCents).toBe(AMOUNT - part);
    });

    it("drops a fully settled invoice from the report entirely", async () => {
      await reset();
      const inv = await issued("2026-06-01");
      const res = await call("POST", "/collections", {
        collectionNo: `COL-A${Date.now() % 1e6}-f`,
        contactName: "Aging Client",
        collectionDate: "2026-06-20",
        amountReceivedCents: AMOUNT,
        ewtCents: 0,
        cashAccountCode: CASH,
      });
      const { collection: col } = (await res.json()) as { collection: { id: string } };
      madeCollections.push(col.id);
      await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: AMOUNT, ewtCents: 0 }],
      });

      const a = await aging();
      expect(a.invoiceCount).toBe(0);
      expect(a.totals.totalCents).toBe(0);
    });

    it("excludes DRAFT invoices — they have no receivable on the books", async () => {
      await reset();
      const res = await call("POST", "/invoices", {
        siNo: `IS-AD${Date.now() % 1e6}`,
        contactName: "Draft Client",
        siDate: "2026-01-05",
        dueDate: "2026-02-05",
        amountCents: AMOUNT,
        netCents: AMOUNT,
        vatCents: 0,
        vatTreatment: "none",
        incomeAccountCode: REVENUE,
      });
      const { invoice } = (await res.json()) as { invoice: { id: string } };
      madeInvoices.push(invoice.id);

      const a = await aging();
      expect(a.invoiceCount).toBe(0);
      expect(a.totals.totalCents).toBe(0);
    });

    it("excludes a cancelled invoice", async () => {
      await reset();
      const inv = await issued("2026-06-01");
      expect((await aging()).totals.totalCents).toBe(AMOUNT);
      expect((await call("POST", `/invoices/${inv.id}/cancel`, {})).status).toBe(200);
      expect((await aging()).totals.totalCents).toBe(0);
    });

    it("re-ages as the as-of date moves forward", async () => {
      await reset();
      await issued("2026-06-01");
      expect((await aging("2026-06-01")).totals.current).toBe(AMOUNT); // due today
      expect((await aging("2026-06-15")).totals.d1_30).toBe(AMOUNT); // 14 days
      expect((await aging("2026-07-15")).totals.d31_60).toBe(AMOUNT); // 44 days
      expect((await aging("2026-08-15")).totals.d61_90).toBe(AMOUNT); // 75 days
      expect((await aging("2026-12-01")).totals.d90_plus).toBe(AMOUNT); // 183 days
    });
  });

  /* ── The acceptance check ────────────────────────────────────────────────── */

  describe("aging total == AR sub-ledger == GL control", () => {
    it("ties out across a mixed portfolio", async () => {
      await reset();
      await issued("2026-08-01");
      await issued("2026-06-15");
      await issued("2026-05-20", { contactName: "Other Co" });
      await issued("2026-01-01", { contactName: "Other Co" });

      const inv = await issued("2026-06-01");
      const part = 250_000;
      const res = await call("POST", "/collections", {
        collectionNo: `COL-A${Date.now() % 1e6}-t`,
        contactName: "Aging Client",
        collectionDate: "2026-06-20",
        amountReceivedCents: part,
        ewtCents: 0,
        cashAccountCode: CASH,
      });
      const { collection: col } = (await res.json()) as { collection: { id: string } };
      madeCollections.push(col.id);
      await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: part, ewtCents: 0 }],
      });

      const a = await aging();
      const r = await recon();

      // The three figures the acceptance check names.
      expect(a.totals.totalCents).toBe(r.arSubLedgerCents);
      expect(a.totals.totalCents).toBe(r.glControlCents);
      expect(r.residualCents).toBe(0);
      expect(r.reconciled).toBe(true);
      expect(a.totals.totalCents).toBe(AMOUNT * 5 - part);
    });

    it("bucket totals sum to the grand total", async () => {
      const a = await aging();
      const summed = AGING_BUCKETS.reduce((s, b) => s + a.totals[b]!, 0);
      expect(summed).toBe(a.totals.totalCents);
    });

    it("each row's buckets sum to its own total", async () => {
      const a = await aging();
      for (const row of a.rows) {
        const summed = AGING_BUCKETS.reduce((s, b) => s + (row as unknown as Record<string, number>)[b]!, 0);
        expect(summed, row.contactName).toBe(row.totalCents);
      }
    });

    it("row totals sum to the grand total", async () => {
      const a = await aging();
      expect(a.rows.reduce((s, r) => s + r.totalCents, 0)).toBe(a.totals.totalCents);
    });
  });

  /* ── Route shape ─────────────────────────────────────────────────────────── */

  describe("the endpoint", () => {
    it("is not swallowed by the CRUD GET /:id route", async () => {
      // `/aging` is registered after the factory's `/:id`; a regression in that
      // ordering would return a single invoice (or 404) instead of the report.
      const res = await call("GET", "/invoices/aging");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty("totals");
      expect(body).toHaveProperty("rows");
      expect(body).not.toHaveProperty("invoice");
    });

    it("defaults asOf to today", async () => {
      const res = await call("GET", "/invoices/aging");
      const body = (await res.json()) as { asOf: string };
      expect(body.asOf).toBe(new Date().toISOString().slice(0, 10));
    });

    it("400s a malformed asOf rather than silently aging as of today", async () => {
      const res = await call("GET", "/invoices/aging?asOf=07-01-2026");
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error?: string }).error).toBe("validation_error");
    });
  });
});
