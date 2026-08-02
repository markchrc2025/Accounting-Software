/**
 * Collections → GL (M2.2) — real Postgres, real routers, RLS-bound as
 * `sentire_books_app`. Skipped unless DATABASE_URL is set.
 *
 * The C1 template, in one shape that covers full / partial / EWT-withheld:
 *
 *     DR  Cash in Bank                 received
 *     DR  Creditable Withholding Tax   ewt        ← omitted entirely when 0
 *         CR  Trade Receivable             received + ewt
 *
 * The headline assertion is the EWT base. On a PHP 100,000.00 + 12% VAT
 * invoice, 2% EWT is 200,000 centavos (2% of the NET 10,000,000), NOT 224,000
 * (2% of the GROSS 11,200,000). Withholding on the VAT-inclusive total is the
 * classic and expensive error, so it is asserted directly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import {
  withOrgContext,
  accounts,
  taxRates,
  collections,
  collectionApplications,
  serviceInvoices,
  journalEntries,
  journalLines,
  DEMO_ORG_ID,
  DEMO_ADMIN_ID,
  DEMO_ADMIN_EMAIL,
} from "@sentire-books/db";
import { serviceInvoiceRoutes, collectionRoutes } from "../routes/billingAr";
import {
  percentageTaxOn,
  resolvePercentageTaxRate,
  FALLBACK_PERCENTAGE_TAX_RATE,
} from "../ledger/postCollection";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

const AR_CONTROL = "1001022";
const REVENUE = "3001001";
const CASH = "1001640"; // Cash in Bank - UB Savings
const CWT = "1009002"; // Creditable Withholding Tax
const TAXES_EXPENSE = "5005"; // Taxes and Licenses
const PT_PAYABLE = "2003004"; // Percentage Tax Payable

const NET = 10_000_000; // PHP 100,000.00
const VAT = 1_200_000; // 12%
const GROSS = NET + VAT; // 11,200,000
const EWT = 200_000; // 2% of NET — the correct base
const EWT_ON_GROSS = 224_000; // 2% of GROSS — the classic error
const CASH_RECEIVED = GROSS - EWT; // 11,000,000

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

let seq = 0;
const madeInvoices: string[] = [];
const madeCollections: string[] = [];

/** An ISSUED invoice with a live receivable. */
async function issuedInvoice(over: Record<string, unknown> = {}) {
  const res = await call("POST", "/invoices", {
    siNo: `IS-C${Date.now() % 1e6}-${++seq}`,
    contactName: "Acme Trading",
    siDate: "2026-05-10",
    amountCents: GROSS,
    netCents: NET,
    vatCents: VAT,
    vatTreatment: "vatable",
    incomeAccountCode: REVENUE,
    ...over,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const { invoice } = (await res.json()) as { invoice: { id: string; siNo: string } };
  madeInvoices.push(invoice.id);
  expect((await call("POST", `/invoices/${invoice.id}/issue`, {})).status).toBe(200);
  return invoice;
}

async function collection(over: Record<string, unknown> = {}) {
  const res = await call("POST", "/collections", {
    collectionNo: `COL-C${Date.now() % 1e6}-${++seq}`,
    contactName: "Acme Trading",
    collectionDate: "2026-05-20",
    amountReceivedCents: CASH_RECEIVED,
    ewtCents: EWT,
    cashAccountCode: CASH,
    ...over,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const { collection: col } = (await res.json()) as { collection: { id: string } };
  madeCollections.push(col.id);
  return col;
}

const linesOf = (entryId: string) =>
  withOrgContext(ctx, (tx) =>
    tx
      .select({
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        debitCents: journalLines.debitCents,
        creditCents: journalLines.creditCents,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, entryId))
      .orderBy(journalLines.lineNo),
  );

const collectionRow = (id: string) =>
  withOrgContext(ctx, (tx) =>
    tx.select().from(collections).where(eq(collections.id, id)).then((r) => r[0]!),
  );
const invoiceRow = (id: string) =>
  withOrgContext(ctx, (tx) =>
    tx.select().from(serviceInvoices).where(eq(serviceInvoices.id, id)).then((r) => r[0]!),
  );

async function trialBalance() {
  const [row] = (await withOrgContext(ctx, (tx) =>
    tx.execute(sql`
      SELECT COALESCE(SUM(jl.debit_cents), 0)::bigint  AS debits,
             COALESCE(SUM(jl.credit_cents), 0)::bigint AS credits
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.entry_id
      WHERE je.org_id = ${DEMO_ORG_ID} AND je.status IN ('posted','reversed')
    `),
  )) as unknown as Array<{ debits: string; credits: string }>;
  return { debits: BigInt(row!.debits), credits: BigInt(row!.credits) };
}

describe.skipIf(!RUN)("M2.2 — collections post to the ledger", () => {
  const saved = { secret: process.env.AUTH_JWT_SECRET, bypass: process.env.AUTH_DEV_BYPASS };

  beforeAll(() => {
    delete process.env.AUTH_JWT_SECRET;
    process.env.AUTH_DEV_BYPASS = "true";
  });

  afterAll(async () => {
    for (const id of madeCollections) {
      await withOrgContext(ctx, (tx) =>
        tx.delete(collectionApplications).where(eq(collectionApplications.collectionId, id)),
      );
      await withOrgContext(ctx, (tx) => tx.delete(collections).where(eq(collections.id, id)));
    }
    for (const id of madeInvoices) {
      await withOrgContext(ctx, (tx) =>
        tx.delete(collectionApplications).where(eq(collectionApplications.invoiceId, id)),
      );
      await withOrgContext(ctx, (tx) => tx.delete(serviceInvoices).where(eq(serviceInvoices.id, id)));
    }
    if (saved.secret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = saved.secret;
    if (saved.bypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = saved.bypass;
  });

  /* ── The headline: EWT is computed on the amount NET of VAT ──────────────── */

  describe("C1 with EWT withheld", () => {
    it("books EWT of 200,000 (2% of NET), not 224,000 (2% of gross)", async () => {
      const inv = await issuedInvoice();
      const col = await collection();

      const res = await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: CASH_RECEIVED, ewtCents: EWT }],
      });
      expect(res.status, await res.clone().text()).toBe(200);

      const lines = await linesOf((await collectionRow(col.id)).bookingJournalEntryId!);
      expect(lines).toHaveLength(3);

      const cash = lines.find((l) => l.code === CASH)!;
      const cwt = lines.find((l) => l.code === CWT)!;
      const ar = lines.find((l) => l.code === AR_CONTROL)!;

      expect(cash.debitCents).toBe(CASH_RECEIVED); // 11,000,000
      expect(cwt.debitCents).toBe(EWT); //    200,000  ← 2% of NET
      expect(cwt.debitCents).not.toBe(EWT_ON_GROSS); // 224,000  ← the error
      expect(cwt.name).toBe("Creditable Withholding Tax");
      expect(cwt.type).toBe("asset"); // an asset we credit against income tax,
      // NOT the 2101 EWT *Payable* liability
      expect(ar.creditCents).toBe(GROSS); // 11,200,000 — the whole receivable

      expect(lines.reduce((s, l) => s + l.debitCents, 0)).toBe(
        lines.reduce((s, l) => s + l.creditCents, 0),
      );
    });

    it("clears the invoice in full — relief is cash + EWT", async () => {
      const inv = await issuedInvoice();
      const col = await collection();
      await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: CASH_RECEIVED, ewtCents: EWT }],
      });

      const row = await invoiceRow(inv.id);
      expect(row.appliedCents).toBe(GROSS);
      expect(row.balanceCents).toBe(0);
    });

    it("computes ar_relief_cents in the DATABASE, not the application", async () => {
      const col = await collection();
      const row = await collectionRow(col.id);
      expect(row.arReliefCents).toBe(CASH_RECEIVED + EWT); // GENERATED column
      expect(row.arReliefCents).toBe(GROSS);
    });
  });

  /* ── Full and partial, no EWT ────────────────────────────────────────────── */

  describe("C1 without EWT", () => {
    it("posts two lines only — no CWT line when nothing was withheld", async () => {
      const inv = await issuedInvoice();
      const col = await collection({ amountReceivedCents: GROSS, ewtCents: 0 });

      expect(
        (
          await call("POST", `/collections/${col.id}/post`, {
            applications: [{ invoiceId: inv.id, appliedCents: GROSS, ewtCents: 0 }],
          })
        ).status,
      ).toBe(200);

      const lines = await linesOf((await collectionRow(col.id)).bookingJournalEntryId!);
      expect(lines).toHaveLength(2);
      expect(lines.some((l) => l.code === CWT)).toBe(false);
      expect(lines.find((l) => l.code === CASH)!.debitCents).toBe(GROSS);
      expect(lines.find((l) => l.code === AR_CONTROL)!.creditCents).toBe(GROSS);
    });

    it("leaves the remainder outstanding on a partial collection", async () => {
      const inv = await issuedInvoice();
      const part = 5_000_000;
      const col = await collection({ amountReceivedCents: part, ewtCents: 0 });

      expect(
        (
          await call("POST", `/collections/${col.id}/post`, {
            applications: [{ invoiceId: inv.id, appliedCents: part, ewtCents: 0 }],
          })
        ).status,
      ).toBe(200);

      const row = await invoiceRow(inv.id);
      expect(row.appliedCents).toBe(part);
      expect(row.balanceCents).toBe(GROSS - part); // 6,200,000
    });
  });

  /* ── Applications across several invoices ────────────────────────────────── */

  describe("collection_applications", () => {
    it("settles several invoices from one collection", async () => {
      const a = await issuedInvoice();
      const b = await issuedInvoice();
      const col = await collection({ amountReceivedCents: GROSS * 2, ewtCents: 0 });

      const res = await call("POST", `/collections/${col.id}/post`, {
        applications: [
          { invoiceId: a.id, appliedCents: GROSS, ewtCents: 0 },
          { invoiceId: b.id, appliedCents: GROSS, ewtCents: 0 },
        ],
      });
      expect(res.status).toBe(200);

      const apps = await withOrgContext(ctx, (tx) =>
        tx
          .select()
          .from(collectionApplications)
          .where(eq(collectionApplications.collectionId, col.id)),
      );
      expect(apps).toHaveLength(2);
      expect(apps.every((x) => x.reliefCents === GROSS)).toBe(true); // GENERATED

      expect((await invoiceRow(a.id)).balanceCents).toBe(0);
      expect((await invoiceRow(b.id)).balanceCents).toBe(0);
    });

    it("is org-scoped by RLS", async () => {
      const rows = await withOrgContext(ctx, (tx) =>
        tx.execute(sql`
          SELECT relrowsecurity FROM pg_class WHERE relname = 'collection_applications'
        `),
      );
      expect((rows as unknown as Array<{ relrowsecurity: boolean }>)[0]!.relrowsecurity).toBe(true);

      // Every row this role can see belongs to the caller's org.
      const foreign = await withOrgContext(ctx, (tx) =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(collectionApplications)
          .where(sql`${collectionApplications.orgId} <> ${DEMO_ORG_ID}`),
      );
      expect(foreign[0]!.n).toBe(0);
    });
  });

  /* ── Guards ──────────────────────────────────────────────────────────────── */

  describe("over-application is refused", () => {
    it("409s when the application exceeds the invoice balance", async () => {
      const inv = await issuedInvoice();
      const col = await collection({ amountReceivedCents: GROSS * 2, ewtCents: 0 });

      const res = await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: GROSS * 2, ewtCents: 0 }],
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error?: string; detail?: string };
      expect(body.error).toBe("over_application");
      expect(body.detail).toContain("outstanding");
    });

    it("409s when applications do not sum to the collection", async () => {
      const inv = await issuedInvoice();
      const col = await collection({ amountReceivedCents: GROSS, ewtCents: 0 });
      const res = await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: 1_000_000, ewtCents: 0 }],
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error?: string }).error).toBe("over_application");
    });

    it("409s when EWT exceeds the invoice's amount net of VAT", async () => {
      const inv = await issuedInvoice();
      // Someone withheld as though the whole gross were the base, and then some.
      const bogus = NET + 1;
      const col = await collection({ amountReceivedCents: 100, ewtCents: bogus });
      const res = await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: 100, ewtCents: bogus }],
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error?: string; detail?: string };
      expect(body.error).toBe("ewt_exceeds_net");
      expect(body.detail).toContain("net of VAT");
    });

    it("409s against an invoice that was never issued", async () => {
      const res0 = await call("POST", "/invoices", {
        siNo: `IS-D${Date.now() % 1e6}`,
        contactName: "Draft Co",
        siDate: "2026-05-10",
        amountCents: NET,
        netCents: NET,
        vatCents: 0,
        vatTreatment: "none",
        incomeAccountCode: REVENUE,
      });
      const { invoice } = (await res0.json()) as { invoice: { id: string } };
      madeInvoices.push(invoice.id);

      const col = await collection({ amountReceivedCents: NET, ewtCents: 0 });
      const res = await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: invoice.id, appliedCents: NET, ewtCents: 0 }],
      });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error?: string }).error).toBe("invoice_not_issued");
    });

    it("409s a double post and does not post twice", async () => {
      const inv = await issuedInvoice();
      const col = await collection({ amountReceivedCents: GROSS, ewtCents: 0 });
      const apps = { applications: [{ invoiceId: inv.id, appliedCents: GROSS, ewtCents: 0 }] };
      expect((await call("POST", `/collections/${col.id}/post`, apps)).status).toBe(200);

      const res = await call("POST", `/collections/${col.id}/post`, apps);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error?: string }).error).toBe("already_posted");

      const entries = await withOrgContext(ctx, (tx) =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(journalEntries)
          .where(and(eq(journalEntries.orgId, DEMO_ORG_ID), eq(journalEntries.sourceId, col.id))),
      );
      expect(entries[0]!.n).toBe(1);
    });

    it("405s a hard DELETE — collections are reverse-only", async () => {
      const col = await collection();
      expect((await call("DELETE", `/collections/${col.id}`)).status).toBe(405);
    });
  });

  /* ── Percentage tax (Sec. 116) ───────────────────────────────────────────── */

  describe("percentage tax on non-VAT receipts", () => {
    it("uses the statutory 3% when the org has configured no rate", async () => {
      const rate = await withOrgContext(ctx, (tx) => resolvePercentageTaxRate(tx, DEMO_ORG_ID));
      expect(rate).toBe(FALLBACK_PERCENTAGE_TAX_RATE);
      expect(rate).toBe(3);
    });

    it("prefers a 'Percentage Tax' rate configured in tax_rates", async () => {
      const [row] = await withOrgContext(ctx, (tx) =>
        tx
          .insert(taxRates)
          .values({ orgId: DEMO_ORG_ID, name: "Percentage Tax", rate: "1.0000", isActive: true } as never)
          .returning(),
      );
      try {
        const rate = await withOrgContext(ctx, (tx) => resolvePercentageTaxRate(tx, DEMO_ORG_ID));
        expect(rate).toBe(1);
      } finally {
        await withOrgContext(ctx, (tx) => tx.delete(taxRates).where(eq(taxRates.id, row!.id)));
      }
    });

    it("accrues DR Taxes and Licenses / CR Percentage Tax Payable as a SEPARATE entry", async () => {
      const inv = await issuedInvoice({
        amountCents: NET,
        netCents: NET,
        vatCents: 0,
        vatTreatment: "none",
      });
      const col = await collection({ amountReceivedCents: NET, ewtCents: 0 });

      const res = await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: NET, ewtCents: 0 }],
      });
      expect(res.status).toBe(200);
      const { percentageTaxEntryNo } = (await res.json()) as { percentageTaxEntryNo?: string };
      expect(percentageTaxEntryNo).toBeDefined();

      const row = await collectionRow(col.id);
      expect(row.percentageTaxCents).toBe(300_000); // 3% of 10,000,000
      expect(row.percentageTaxJournalEntryId).not.toBeNull();
      // A separate entry from the cash one, so each can reverse independently.
      expect(row.percentageTaxJournalEntryId).not.toBe(row.bookingJournalEntryId);

      const lines = await linesOf(row.percentageTaxJournalEntryId!);
      expect(lines).toHaveLength(2);
      expect(lines.find((l) => l.code === TAXES_EXPENSE)!.debitCents).toBe(300_000);
      expect(lines.find((l) => l.code === PT_PAYABLE)!.creditCents).toBe(300_000);
    });

    it("does NOT accrue percentage tax on a VATable collection", async () => {
      const inv = await issuedInvoice(); // vatable
      const col = await collection();
      await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: CASH_RECEIVED, ewtCents: EWT }],
      });
      const row = await collectionRow(col.id);
      expect(row.percentageTaxCents).toBe(0);
      expect(row.percentageTaxJournalEntryId).toBeNull();
    });

    it("computes the accrual with integer arithmetic", () => {
      expect(percentageTaxOn(10_000_000, 3)).toBe(300_000);
      expect(percentageTaxOn(10_000_000, 1)).toBe(100_000);
      expect(percentageTaxOn(3_333_333, 3)).toBe(100_000); // rounded once, not accumulated
      expect(percentageTaxOn(0, 3)).toBe(0);
      expect(percentageTaxOn(10_000_000, 0)).toBe(0);
      expect(Number.isInteger(percentageTaxOn(1_234_567, 3))).toBe(true);
    });
  });

  /* ── Void reverses both entries ──────────────────────────────────────────── */

  describe("void reverses and rolls the receivable back", () => {
    it("reverses both entries, restores the invoice balance, drops the applications", async () => {
      const inv = await issuedInvoice({
        amountCents: NET,
        netCents: NET,
        vatCents: 0,
        vatTreatment: "none",
      });
      const col = await collection({ amountReceivedCents: NET, ewtCents: 0 });
      await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: NET, ewtCents: 0 }],
      });

      const posted = await collectionRow(col.id);
      const cashEntry = posted.bookingJournalEntryId!;
      const ptEntry = posted.percentageTaxJournalEntryId!;
      expect((await invoiceRow(inv.id)).balanceCents).toBe(0);

      expect((await call("POST", `/collections/${col.id}/void`, {})).status).toBe(200);

      for (const id of [cashEntry, ptEntry]) {
        const [original] = await withOrgContext(ctx, (tx) =>
          tx.select().from(journalEntries).where(eq(journalEntries.id, id)),
        );
        expect(original!.status).toBe("reversed");
        const [rev] = await withOrgContext(ctx, (tx) =>
          tx.select().from(journalEntries).where(eq(journalEntries.reversalOf, id)),
        );
        expect(rev!.status).toBe("posted");
      }

      // Receivable is outstanding again and the applications are gone.
      expect((await invoiceRow(inv.id)).balanceCents).toBe(NET);
      const apps = await withOrgContext(ctx, (tx) =>
        tx.select().from(collectionApplications).where(eq(collectionApplications.collectionId, col.id)),
      );
      expect(apps).toHaveLength(0);

      const row = await collectionRow(col.id);
      expect(row.status).toBe("Voided");
      expect(row.bookingJournalEntryId).toBeNull();
    });

    it("400s voiding a collection that was never posted", async () => {
      const col = await collection();
      const res = await call("POST", `/collections/${col.id}/void`, {});
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error?: string }).error).toBe("not_posted");
    });
  });

  /* ── The invariant ───────────────────────────────────────────────────────── */

  describe("the ledger still reconciles", () => {
    it("keeps the trial balance balanced to the centavo", async () => {
      const tb = await trialBalance();
      expect(tb.debits).toBe(tb.credits);
      // eslint-disable-next-line no-console
      console.log(`    trial balance: ${tb.debits} centavos on each side`);
    });
  });
});
