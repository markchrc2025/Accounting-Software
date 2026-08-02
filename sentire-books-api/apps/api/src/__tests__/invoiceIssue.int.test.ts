/**
 * Invoice issuance → GL (M2.1) — real Postgres, real routers, RLS-bound as
 * `sentire_books_app`. Skipped unless DATABASE_URL is set.
 *
 * Proves the three issuance templates from the approved M2 proposal post the
 * right lines to the right accounts, that issuing is atomic with the status
 * flip, that cancelling reverses rather than mutates, and that the org's trial
 * balance still reconciles to the centavo afterwards.
 *
 * Worked example used throughout — a PHP 100,000.00 service fee:
 *   net 10,000,000 · VAT 12% 1,200,000 · gross 11,200,000 centavos
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import {
  withOrgContext,
  accounts,
  contacts,
  serviceInvoices,
  journalEntries,
  journalLines,
  DEMO_ORG_ID,
  DEMO_ADMIN_ID,
  DEMO_ADMIN_EMAIL,
} from "@sentire-books/db";
import { serviceInvoiceRoutes } from "../routes/billingAr";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

const AR_CONTROL = "1001022"; // Trade Receivable - Client
const AR_CLIENT = "DO103"; // a per-client receivable sub-account
const REVENUE = "3001001"; // Manpower Service Revenue
const OUTPUT_VAT = "2003003"; // Output Tax

const NET = 10_000_000;
const VAT = 1_200_000;
const GROSS = NET + VAT;

const app = new Hono();
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

let seq = 0;
const nextNo = () => `IS-T${Date.now() % 1e6}-${++seq}`;

const made: string[] = [];
/** Contacts must outlive the invoices that reference them (FK). */
const madeContacts: string[] = [];

/** Create a draft invoice straight through the CRUD route. */
async function draft(over: Record<string, unknown> = {}) {
  const res = await call("POST", "/invoices", {
    siNo: nextNo(),
    contactName: "Acme Trading",
    siDate: "2026-04-15",
    amountCents: NET,
    netCents: NET,
    vatCents: 0,
    vatTreatment: "none",
    incomeAccountCode: REVENUE,
    ...over,
  });
  expect(res.status, `draft create: ${await res.clone().text()}`).toBe(201);
  const { invoice } = (await res.json()) as { invoice: { id: string } };
  made.push(invoice.id);
  return invoice as { id: string; siNo: string; status: string };
}

/** Posted lines of an entry, joined to the accounts actually hit. */
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

const invoiceRow = (id: string) =>
  withOrgContext(ctx, (tx) =>
    tx.select().from(serviceInvoices).where(eq(serviceInvoices.id, id)).then((r) => r[0]!),
  );

/** Whole-org trial balance over posted + reversed entries. */
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

describe.skipIf(!RUN)("M2.1 — invoice issuance posts to the ledger", () => {
  const saved = { secret: process.env.AUTH_JWT_SECRET, bypass: process.env.AUTH_DEV_BYPASS };

  beforeAll(() => {
    delete process.env.AUTH_JWT_SECRET;
    process.env.AUTH_DEV_BYPASS = "true";
  });

  afterAll(async () => {
    for (const id of made) {
      await withOrgContext(ctx, (tx) => tx.delete(serviceInvoices).where(eq(serviceInvoices.id, id)));
    }
    // Only after the invoices that reference them are gone.
    for (const id of madeContacts) {
      await withOrgContext(ctx, (tx) => tx.delete(contacts).where(eq(contacts.id, id)));
    }
    if (saved.secret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = saved.secret;
    if (saved.bypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = saved.bypass;
  });

  /* ── T1 — VAT-registered ─────────────────────────────────────────────────── */

  describe("T1 — VATable invoice", () => {
    it("posts DR AR gross / CR Revenue net / CR Output Tax vat", async () => {
      const inv = await draft({
        amountCents: GROSS,
        netCents: NET,
        vatCents: VAT,
        vatTreatment: "vatable",
      });

      const res = await call("POST", `/invoices/${inv.id}/issue`, {});
      expect(res.status, await res.clone().text()).toBe(200);
      const { journalEntryNo } = (await res.json()) as { journalEntryNo: string };
      expect(journalEntryNo).toMatch(/^JE202604-\d{4}$/);

      const row = await invoiceRow(inv.id);
      const lines = await linesOf(row.bookingJournalEntryId!);
      expect(lines).toHaveLength(3);

      const [ar, rev, vat] = lines;
      expect(ar!.code).toBe(AR_CONTROL);
      expect(ar!.type).toBe("asset");
      expect(ar!.debitCents).toBe(GROSS); // 11,200,000

      expect(rev!.code).toBe(REVENUE);
      expect(rev!.type).toBe("income");
      expect(rev!.creditCents).toBe(NET); // 10,000,000

      expect(vat!.code).toBe(OUTPUT_VAT);
      expect(vat!.name).toBe("Output Tax");
      expect(vat!.type).toBe("liability");
      expect(vat!.creditCents).toBe(VAT); // 1,200,000

      // Balanced to the centavo.
      expect(lines.reduce((s, l) => s + l.debitCents, 0)).toBe(
        lines.reduce((s, l) => s + l.creditCents, 0),
      );
    });

    it("flips the invoice to Issued and stamps the accounts it used", async () => {
      const inv = await draft({ amountCents: GROSS, netCents: NET, vatCents: VAT, vatTreatment: "vatable" });
      await call("POST", `/invoices/${inv.id}/issue`, {});

      const row = await invoiceRow(inv.id);
      expect(row.status).toBe("Issued");
      expect(row.bookedAt).not.toBeNull();
      expect(row.bookingMode).toBe("vatable");
      expect(row.arAccountCode).toBe(AR_CONTROL);
      expect(row.incomeAccountCode).toBe(REVENUE);
      expect(row.outputVatAccountCode).toBe(OUTPUT_VAT);
    });
  });

  /* ── T2 / T3 — no VAT line ───────────────────────────────────────────────── */

  describe("T2 — non-VAT (percentage-tax) invoice", () => {
    it("posts two lines only, with NO tax line", async () => {
      const inv = await draft({ vatTreatment: "none" });
      const res = await call("POST", `/invoices/${inv.id}/issue`, {});
      expect(res.status).toBe(200);

      const lines = await linesOf((await invoiceRow(inv.id)).bookingJournalEntryId!);
      expect(lines).toHaveLength(2);
      expect(lines[0]!.code).toBe(AR_CONTROL);
      expect(lines[0]!.debitCents).toBe(NET);
      expect(lines[1]!.code).toBe(REVENUE);
      expect(lines[1]!.creditCents).toBe(NET);
      // Percentage tax is the seller's expense, accrued on collection — never
      // billed to the client, so it must not appear on the invoice entry.
      expect(lines.some((l) => l.code === OUTPUT_VAT)).toBe(false);
    });
  });

  describe("T3 — VAT-exempt and zero-rated", () => {
    it.each([["exempt"], ["zero_rated"]])("posts the same two lines for '%s'", async (treatment) => {
      const inv = await draft({ vatTreatment: treatment });
      expect((await call("POST", `/invoices/${inv.id}/issue`, {})).status).toBe(200);

      const row = await invoiceRow(inv.id);
      const lines = await linesOf(row.bookingJournalEntryId!);
      expect(lines).toHaveLength(2);
      expect(lines[0]!.debitCents).toBe(NET);
      expect(lines[1]!.creditCents).toBe(NET);
      // The ledger cannot tell exempt from zero-rated from non-VAT — which is
      // exactly why the treatment is carried on the invoice.
      expect(row.vatTreatment).toBe(treatment);
      expect(row.bookingMode).toBe(treatment);
    });
  });

  /* ── Account resolution ──────────────────────────────────────────────────── */

  describe("receivable account resolution", () => {
    it("prefers the customer contact's own AR sub-account", async () => {
      const [contact] = await withOrgContext(ctx, (tx) =>
        tx
          .insert(contacts)
          .values({
            orgId: DEMO_ORG_ID,
            name: `AR Client ${Date.now()}`,
            type: "customer",
            arAccountCode: AR_CLIENT,
          } as never)
          .returning(),
      );
      madeContacts.push(contact!.id);

      const inv = await draft({ contactId: contact!.id, contactName: contact!.name });
      expect((await call("POST", `/invoices/${inv.id}/issue`, {})).status).toBe(200);

      const row = await invoiceRow(inv.id);
      expect(row.arAccountCode).toBe(AR_CLIENT);
      const lines = await linesOf(row.bookingJournalEntryId!);
      expect(lines[0]!.code).toBe(AR_CLIENT);
      expect(lines[0]!.debitCents).toBe(NET);
    });

    it("lets the request override the account for this posting", async () => {
      const inv = await draft();
      expect((await call("POST", `/invoices/${inv.id}/issue`, { arAccountCode: AR_CLIENT })).status).toBe(200);
      expect((await linesOf((await invoiceRow(inv.id)).bookingJournalEntryId!))[0]!.code).toBe(AR_CLIENT);
    });

    it("400s with an actionable message when no income account is set", async () => {
      const inv = await draft({ incomeAccountCode: null });
      const res = await call("POST", `/invoices/${inv.id}/issue`, {});
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string; detail?: string };
      expect(body.error).toBe("accounts_unset");
      expect(body.detail).toContain("income account");
    });
  });

  /* ── Guards ──────────────────────────────────────────────────────────────── */

  describe("issuing is guarded", () => {
    it("409s a second issue and does not post twice", async () => {
      const inv = await draft();
      expect((await call("POST", `/invoices/${inv.id}/issue`, {})).status).toBe(200);

      const res = await call("POST", `/invoices/${inv.id}/issue`, {});
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error?: string }).error).toBe("already_issued");

      const counted = await withOrgContext(ctx, (tx) =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(journalEntries)
          .where(and(eq(journalEntries.orgId, DEMO_ORG_ID), eq(journalEntries.sourceId, inv.id))),
      );
      expect(counted[0]!.n).toBe(1);
    });

    it("404s an unknown invoice", async () => {
      const res = await call("POST", "/invoices/00000000-0000-0000-0000-0000000000ff/issue", {});
      expect(res.status).toBe(404);
    });

    it("400s a zero-amount invoice", async () => {
      const inv = await draft({ amountCents: 0, netCents: 0, vatCents: 0 });
      const res = await call("POST", `/invoices/${inv.id}/issue`, {});
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error?: string }).error).toBe("nothing_to_issue");
    });

    it("405s a hard DELETE — invoices are reverse-only", async () => {
      const inv = await draft();
      const res = await call("DELETE", `/invoices/${inv.id}`);
      expect(res.status).toBe(405);
      const still = await withOrgContext(ctx, (tx) =>
        tx.select().from(serviceInvoices).where(eq(serviceInvoices.id, inv.id)),
      );
      expect(still).toHaveLength(1);
    });
  });

  /* ── Validation is enforced by BOTH zod and the database ─────────────────── */

  describe("the VAT decomposition cannot drift", () => {
    it("rejects amountCents that is not netCents + vatCents", async () => {
      const res = await call("POST", "/invoices", {
        siNo: nextNo(),
        contactName: "Bad Math",
        siDate: "2026-04-15",
        amountCents: 9_999_999,
        netCents: NET,
        vatCents: VAT,
        vatTreatment: "vatable",
        incomeAccountCode: REVENUE,
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error?: string }).error).toBe("validation_error");
    });

    it("rejects VAT on a non-VATable treatment", async () => {
      const res = await call("POST", "/invoices", {
        siNo: nextNo(),
        contactName: "Exempt With VAT",
        siDate: "2026-04-15",
        amountCents: GROSS,
        netCents: NET,
        vatCents: VAT,
        vatTreatment: "exempt",
        incomeAccountCode: REVENUE,
      });
      expect(res.status).toBe(400);
    });

    it("is enforced by the DATABASE too, not only by zod", async () => {
      // Bypass the route and write straight to the table — the CHECK must hold.
      const write = withOrgContext(ctx, (tx) =>
        tx.insert(serviceInvoices).values({
          orgId: DEMO_ORG_ID,
          siNo: nextNo(),
          contactName: "Direct Write",
          siDate: "2026-04-15",
          amountCents: 500,
          netCents: 100,
          vatCents: 100, // 100 + 100 != 500
        } as never),
      );
      await expect(write).rejects.toThrow(/service_invoices_amount_decomposed_chk/);
    });
  });

  /* ── Cancel reverses, never mutates ──────────────────────────────────────── */

  describe("cancel reverses the issuance entry", () => {
    it("posts a reversing entry and leaves the original intact", async () => {
      const inv = await draft({ amountCents: GROSS, netCents: NET, vatCents: VAT, vatTreatment: "vatable" });
      await call("POST", `/invoices/${inv.id}/issue`, {});
      const originalId = (await invoiceRow(inv.id)).bookingJournalEntryId!;

      const res = await call("POST", `/invoices/${inv.id}/cancel`, {});
      expect(res.status).toBe(200);

      const [original] = await withOrgContext(ctx, (tx) =>
        tx.select().from(journalEntries).where(eq(journalEntries.id, originalId)),
      );
      // Marked reversed — the only mutation the append-only trigger permits.
      expect(original!.status).toBe("reversed");

      const [reversal] = await withOrgContext(ctx, (tx) =>
        tx.select().from(journalEntries).where(eq(journalEntries.reversalOf, originalId)),
      );
      expect(reversal!.status).toBe("posted");
      expect(reversal!.entryType).toBe("Reversing");

      // Debits and credits swapped, same three accounts, same amounts.
      const orig = await linesOf(originalId);
      const rev = await linesOf(reversal!.id);
      expect(rev.map((l) => l.code).sort()).toEqual(orig.map((l) => l.code).sort());
      expect(rev.reduce((s, l) => s + l.creditCents, 0)).toBe(
        orig.reduce((s, l) => s + l.debitCents, 0),
      );

      const row = await invoiceRow(inv.id);
      expect(row.status).toBe("Cancelled");
      expect(row.bookingJournalEntryId).toBeNull();
    });

    it("409s when a collection has already been applied", async () => {
      const inv = await draft();
      await call("POST", `/invoices/${inv.id}/issue`, {});
      await withOrgContext(ctx, (tx) =>
        tx.update(serviceInvoices).set({ appliedCents: 500 }).where(eq(serviceInvoices.id, inv.id)),
      );

      const res = await call("POST", `/invoices/${inv.id}/cancel`, {});
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error?: string }).error).toBe("has_collections");
    });
  });

  /* ── The invariant that matters ──────────────────────────────────────────── */

  describe("the ledger still reconciles", () => {
    it("keeps the trial balance balanced to the centavo after all of the above", async () => {
      const tb = await trialBalance();
      expect(tb.debits).toBe(tb.credits);
      // eslint-disable-next-line no-console
      console.log(`    trial balance: ${tb.debits} centavos on each side`);
    });
  });
});
