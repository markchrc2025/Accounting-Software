/**
 * AR sub-ledger ⇄ GL reconciliation (M2.3) — real Postgres, real routers,
 * RLS-bound as `sentire_books_app`. Skipped unless DATABASE_URL is set.
 *
 * The identity under test:
 *
 *     residual = glControl − (arSubLedger − unissuedInvoices)
 *
 * Exercised across every permutation the tile exists to explain:
 * issued / unissued invoices × posted / unposted collections. `residual` must
 * be 0 in all of them — a non-zero residual means the GL moved in a way the
 * sub-ledger cannot account for, which is the drift this tile surfaces.
 *
 * An unposted collection is deliberately NOT a term in the identity: it has no
 * `collection_applications` rows, so it has not reduced any invoice's
 * `applied_cents` and is invisible to BOTH sides. Adding it back would
 * double-count. It is reported as an explanatory figure instead, and there is a
 * test asserting exactly that.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
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
import { reverseJournalEntryCore } from "../ledger/postJournalEntry";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

const REVENUE = "3001001";
const CASH = "1001640";
const AR_CONTROL = "1001022";

const NET = 10_000_000;
const VAT = 1_200_000;
const GROSS = NET + VAT;

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

interface Recon {
  glControlCents: number;
  arSubLedgerCents: number;
  unissuedCents: number;
  unpostedCollectionCents: number;
  residualCents: number;
  reconciled: boolean;
  arAccountCodes: string[];
  unissuedInvoices: Array<{ siNo: string; outstandingCents: number }>;
  unpostedCollections: Array<{ collectionNo: string; reliefCents: number }>;
}

async function recon(): Promise<Recon> {
  const res = await call("GET", "/collections/ar-reconciliation");
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Recon;
}

let seq = 0;
const madeInvoices: string[] = [];
const madeCollections: string[] = [];

async function draft(over: Record<string, unknown> = {}) {
  const res = await call("POST", "/invoices", {
    siNo: `IS-R${Date.now() % 1e6}-${++seq}`,
    contactName: "Recon Client",
    siDate: "2026-06-05",
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
  return invoice;
}

async function issued(over: Record<string, unknown> = {}) {
  const inv = await draft(over);
  expect((await call("POST", `/invoices/${inv.id}/issue`, {})).status).toBe(200);
  return inv;
}

async function collection(over: Record<string, unknown> = {}) {
  const res = await call("POST", "/collections", {
    collectionNo: `COL-R${Date.now() % 1e6}-${++seq}`,
    contactName: "Recon Client",
    collectionDate: "2026-06-20",
    amountReceivedCents: GROSS,
    ewtCents: 0,
    cashAccountCode: CASH,
    ...over,
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const { collection: col } = (await res.json()) as { collection: { id: string; collectionNo: string } };
  madeCollections.push(col.id);
  return col;
}

/**
 * Remove everything this file created, so each permutation starts clean.
 *
 * Unwinds through the API — void, then cancel — so every posted entry is
 * REVERSED and the GL is left net-zero. Deleting the rows alone would strand
 * their journal entries, and an orphaned AR debit is indistinguishable from
 * real drift: the next permutation would open with a non-zero residual.
 */
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

describe.skipIf(!RUN)("M2.3 — AR sub-ledger reconciles to the GL", () => {
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

  /* ── residual is 0 across every permutation ──────────────────────────────── */

  describe("residual is 0 across issued / unissued × posted / unposted", () => {
    it("baseline: no AR documents at all", async () => {
      await reset();
      const r = await recon();
      expect(r.residualCents).toBe(0);
    });

    it("issued invoice, nothing collected", async () => {
      await reset();
      const before = await recon();
      await issued();

      const r = await recon();
      expect(r.glControlCents).toBe(before.glControlCents + GROSS);
      expect(r.arSubLedgerCents).toBe(before.arSubLedgerCents + GROSS);
      expect(r.unissuedCents).toBe(0);
      expect(r.residualCents).toBe(0);
    });

    it("UNISSUED invoice — sub-ledger counts it, GL has never seen it", async () => {
      await reset();
      const before = await recon();
      const inv = await draft();

      const r = await recon();
      // GL unmoved; sub-ledger up; the difference is exactly the unissued figure.
      expect(r.glControlCents).toBe(before.glControlCents);
      expect(r.arSubLedgerCents).toBe(before.arSubLedgerCents + GROSS);
      expect(r.unissuedCents).toBe(GROSS);
      expect(r.unissuedInvoices.map((i) => i.siNo)).toContain(inv.siNo);
      expect(r.residualCents).toBe(0); // the term explains the whole gap
      expect(r.reconciled).toBe(false); // pending work exists
    });

    it("issued invoice + POSTED collection — both sides move together", async () => {
      await reset();
      const before = await recon();
      const inv = await issued();
      const col = await collection();
      expect(
        (
          await call("POST", `/collections/${col.id}/post`, {
            applications: [{ invoiceId: inv.id, appliedCents: GROSS, ewtCents: 0 }],
          })
        ).status,
      ).toBe(200);

      const r = await recon();
      expect(r.glControlCents).toBe(before.glControlCents); // debit then credit
      expect(r.arSubLedgerCents).toBe(before.arSubLedgerCents); // fully applied
      expect(r.residualCents).toBe(0);
    });

    it("issued invoice + UNPOSTED collection — explanatory, not a term", async () => {
      await reset();
      const inv = await issued();
      const col = await collection();

      const r = await recon();
      // The collection has no applications, so it has moved NEITHER side.
      expect(r.unpostedCollectionCents).toBe(GROSS);
      expect(r.unpostedCollections.map((c) => c.collectionNo)).toContain(col.collectionNo);
      expect(r.arSubLedgerCents).toBeGreaterThanOrEqual(GROSS); // invoice still owed
      expect(r.residualCents).toBe(0); // and still no drift
      expect(r.reconciled).toBe(false); // but cash is unrecorded — surface it
      expect(inv.siNo).toBeTruthy();
    });

    it("partial collection leaves the remainder on both sides", async () => {
      await reset();
      const before = await recon();
      const inv = await issued();
      const part = 5_000_000;
      const col = await collection({ amountReceivedCents: part });
      expect(
        (
          await call("POST", `/collections/${col.id}/post`, {
            applications: [{ invoiceId: inv.id, appliedCents: part, ewtCents: 0 }],
          })
        ).status,
      ).toBe(200);

      const r = await recon();
      expect(r.glControlCents).toBe(before.glControlCents + GROSS - part);
      expect(r.arSubLedgerCents).toBe(before.arSubLedgerCents + GROSS - part);
      expect(r.residualCents).toBe(0);
    });

    it("EWT collection — relief is cash + EWT on both sides", async () => {
      await reset();
      const before = await recon();
      const inv = await issued();
      const ewt = 200_000;
      const cash = GROSS - ewt;
      const col = await collection({ amountReceivedCents: cash, ewtCents: ewt });
      expect(
        (
          await call("POST", `/collections/${col.id}/post`, {
            applications: [{ invoiceId: inv.id, appliedCents: cash, ewtCents: ewt }],
          })
        ).status,
      ).toBe(200);

      const r = await recon();
      expect(r.glControlCents).toBe(before.glControlCents);
      expect(r.arSubLedgerCents).toBe(before.arSubLedgerCents);
      expect(r.residualCents).toBe(0);
    });

    it("cancelled invoice drops off both sides", async () => {
      await reset();
      const before = await recon();
      const inv = await issued();
      expect((await call("POST", `/invoices/${inv.id}/cancel`, {})).status).toBe(200);

      const r = await recon();
      expect(r.glControlCents).toBe(before.glControlCents); // reversed
      expect(r.arSubLedgerCents).toBe(before.arSubLedgerCents); // excluded
      expect(r.residualCents).toBe(0);
    });

    it("voided collection restores both sides", async () => {
      await reset();
      const inv = await issued();
      const col = await collection();
      await call("POST", `/collections/${col.id}/post`, {
        applications: [{ invoiceId: inv.id, appliedCents: GROSS, ewtCents: 0 }],
      });
      const afterPost = await recon();

      expect((await call("POST", `/collections/${col.id}/void`, {})).status).toBe(200);
      const r = await recon();

      expect(r.arSubLedgerCents).toBe(afterPost.arSubLedgerCents + GROSS);
      expect(r.glControlCents).toBe(afterPost.glControlCents + GROSS);
      expect(r.residualCents).toBe(0);
    });

    it("several invoices and collections mixed together", async () => {
      await reset();
      const before = await recon();

      const a = await issued(); // issued, untouched
      const b = await issued(); // issued, fully collected
      await draft(); // unissued
      const c = await issued(); // issued, partially collected

      const colB = await collection();
      await call("POST", `/collections/${colB.id}/post`, {
        applications: [{ invoiceId: b.id, appliedCents: GROSS, ewtCents: 0 }],
      });
      const colC = await collection({ amountReceivedCents: 2_000_000 });
      await call("POST", `/collections/${colC.id}/post`, {
        applications: [{ invoiceId: c.id, appliedCents: 2_000_000, ewtCents: 0 }],
      });
      await collection({ amountReceivedCents: 999 }); // unposted

      const r = await recon();
      expect(r.unissuedCents).toBe(GROSS);
      expect(r.unpostedCollectionCents).toBe(999);
      // GL: a (full) + c (remainder). Sub-ledger: those plus the unissued one.
      expect(r.glControlCents).toBe(before.glControlCents + GROSS + (GROSS - 2_000_000));
      expect(r.arSubLedgerCents).toBe(
        before.arSubLedgerCents + GROSS + (GROSS - 2_000_000) + GROSS,
      );
      expect(r.residualCents).toBe(0);
      expect(a.siNo).toBeTruthy();
    });
  });

  /* ── The tile's reason for existing: catching real drift ─────────────────── */

  describe("drift is surfaced, not hidden", () => {
    it("reports a non-zero residual when the GL moves without the sub-ledger", async () => {
      await reset();
      const clean = await recon();
      expect(clean.residualCents).toBe(0);

      // A manual journal entry straight against the AR control account — the
      // exact thing that makes a sub-ledger stop agreeing with the GL.
      const entryId = await withOrgContext(ctx, async (tx) => {
        const rows = (await tx.execute(sql`
          INSERT INTO journal_entries (org_id, entry_no, entry_date, memo, status, entry_type, created_by)
          VALUES (${DEMO_ORG_ID}, ${`JE-DRIFT-${Date.now() % 1e6}`}, '2026-06-30',
                  'Manual AR adjustment', 'draft', 'Manual', ${DEMO_ADMIN_ID})
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        const id = rows[0]!.id;
        // postgres-js binds these as text; the columns are uuid.
        await tx.execute(sql`
          INSERT INTO journal_lines (entry_id, line_no, account_id, debit_cents, credit_cents)
          SELECT ${id}::uuid, 1, id, 750000, 0 FROM accounts
           WHERE org_id = ${DEMO_ORG_ID} AND code = ${AR_CONTROL}
          UNION ALL
          SELECT ${id}::uuid, 2, id, 0, 750000 FROM accounts
           WHERE org_id = ${DEMO_ORG_ID} AND code = ${REVENUE}
        `);
        await tx.execute(
          sql`UPDATE journal_entries SET status='posted', posted_at=now() WHERE id=${id}::uuid`,
        );
        return id;
      });

      try {
        const drifted = await recon();
        // The GL grew; the sub-ledger did not; the residual names the gap.
        expect(drifted.glControlCents).toBe(clean.glControlCents + 750_000);
        expect(drifted.arSubLedgerCents).toBe(clean.arSubLedgerCents);
        expect(drifted.residualCents).toBe(750_000);
        expect(drifted.reconciled).toBe(false);
      } finally {
        // Reverse it the way the product would, rather than deleting — the
        // append-only triggers exist precisely to stop the latter.
        await withOrgContext(ctx, (tx) =>
          reverseJournalEntryCore(tx, entryId, { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID }),
        );
      }
    });

    it("reports reconciled=true only when nothing is pending and there is no drift", async () => {
      await reset();
      const r = await recon();
      expect(r.residualCents).toBe(0);
      expect(r.unissuedCents).toBe(0);
      expect(r.unpostedCollectionCents).toBe(0);
      expect(r.reconciled).toBe(true);
    });
  });

  /* ── Shape ───────────────────────────────────────────────────────────────── */

  it("reports which AR accounts it reconciled", async () => {
    await reset();
    await issued();
    const r = await recon();
    expect(r.arAccountCodes).toContain(AR_CONTROL);
  });
});
