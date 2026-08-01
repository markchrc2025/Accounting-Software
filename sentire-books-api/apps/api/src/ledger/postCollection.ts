/**
 * Collections → General Ledger (M2.2).
 *
 * Posting a collection relieves the receivable and books the cash, through
 * `postJournalEntryCore()`. Voiding reverses through `reverseJournalEntryCore()`.
 *
 * ── The template (C1) ────────────────────────────────────────────────────────
 * With `received` = cash actually banked and `ewt` = the amount on the BIR 2307:
 *
 *     DR  Cash in Bank                 received
 *     DR  Creditable Withholding Tax   ewt          ← omitted entirely when 0
 *         CR  Trade Receivable             received + ewt
 *
 * The three cases in the proposal collapse into this one template:
 *   • full, no EWT      → ewt = 0, received = invoice balance
 *   • partial, no EWT   → ewt = 0, received < invoice balance
 *   • with EWT withheld → ewt > 0
 *
 * ── EWT is captured, not derived ─────────────────────────────────────────────
 * The payor computes what they withhold and gives us the 2307. Deriving it here
 * would guarantee eventual disagreement with the certificate we must match. So
 * `ewtCents` is an input — but we DO assert its base: EWT is computed on the
 * amount NET of VAT. Withholding on the VAT-inclusive total is the classic
 * error (2% of 112,000 = 2,240 instead of 2% of 100,000 = 2,000), so a
 * collection whose EWT exceeds what the net could support is refused.
 *
 * ── Percentage tax (Sec. 116) ────────────────────────────────────────────────
 * For non-VAT tenants only — invoices whose `vatTreatment` is 'none'. It is the
 * SELLER's expense, never billed to or withheld from the client, and is
 * recognised against receipts. Posted as a SEPARATE entry so the cash movement
 * and the tax accrual can be reversed independently:
 *
 *     DR  Taxes and Licenses        rate × net receipts
 *         CR  Percentage Tax Payable    rate × net receipts
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  collections,
  collectionApplications,
  serviceInvoices,
  taxRates,
  type Tx,
} from "@sentire-books/db";
import { postJournalEntryCore, reverseJournalEntryCore } from "./postJournalEntry";
import { resolveAccountCodes } from "./resolveAccounts";
import { DEFAULT_AR_ACCOUNT } from "./postInvoice";

export const POSTED_STATUS = "Posted";
export const VOIDED_STATUS = "Voided";
const POSTABLE_STATUSES = new Set(["Unposted", "Draft", "Pending"]);

/** Creditable Withholding Tax — the asset for EWT our clients withhold from us. */
export const DEFAULT_CWT_ACCOUNT = "1009002";
/** Sec. 116 percentage tax. */
export const DEFAULT_PERCENTAGE_TAX_PAYABLE = "2003004";
export const DEFAULT_TAXES_AND_LICENSES = "5005";

/**
 * Sec. 116 rate when the org has not configured one.
 *
 * 3% is the standing statutory rate. The CREATE Act cut it to 1% for
 * 1 Jul 2020 – 30 Jun 2023; that concession has lapsed. Configure a
 * `tax_rates` row named "Percentage Tax" to override.
 */
export const FALLBACK_PERCENTAGE_TAX_RATE = 3;

/** Names we look for in `tax_rates` before falling back, most specific first. */
const PERCENTAGE_TAX_RATE_NAMES = ["percentage tax", "percentage tax (sec. 116)", "sec 116", "sec. 116"];

type Collection = typeof collections.$inferSelect;
type Invoice = typeof serviceInvoices.$inferSelect;

export type PostFailure =
  | "already_posted"
  | "not_postable"
  | "nothing_to_post"
  | "accounts_unset"
  | "no_applications"
  | "over_application"
  | "ewt_exceeds_net"
  | "invoice_not_issued";

export interface ApplicationInput {
  invoiceId: string;
  appliedCents: number;
  ewtCents?: number | undefined;
}

export interface PostCollectionOptions {
  date?: string | undefined;
  cashAccountCode?: string | null | undefined;
  cwtAccountCode?: string | null | undefined;
  arAccountCode?: string | null | undefined;
  applications: readonly ApplicationInput[];
}

export interface PostCollectionResult {
  ok: true;
  collection: Collection;
  journalEntryNo: string;
  percentageTaxEntryNo?: string;
  applications: Array<{ invoiceId: string; siNo: string; appliedCents: number; ewtCents: number }>;
}

export type PostResult = PostCollectionResult | { ok: false; error: PostFailure; detail?: string };

/**
 * Resolve the Sec. 116 rate from the org's own tax registry, falling back to
 * the statutory 3%. Returns the rate as a percentage (3 means 3%).
 */
export async function resolvePercentageTaxRate(tx: Tx, orgId: string): Promise<number> {
  const rows = await tx
    .select({ name: taxRates.name, rate: taxRates.rate })
    .from(taxRates)
    .where(and(eq(taxRates.orgId, orgId), eq(taxRates.isActive, true)));

  for (const wanted of PERCENTAGE_TAX_RATE_NAMES) {
    const hit = rows.find((r) => r.name.trim().toLowerCase() === wanted);
    if (hit) {
      const rate = Number(hit.rate);
      if (Number.isFinite(rate) && rate > 0) return rate;
    }
  }
  return FALLBACK_PERCENTAGE_TAX_RATE;
}

/**
 * Percentage tax on the NET receipts of non-VAT invoices settled here.
 *
 * Integer arithmetic throughout — `Math.round` on the single final division,
 * never a float accumulated across lines (invariant #6).
 */
export function percentageTaxOn(netReceiptsCents: number, ratePercent: number): number {
  if (netReceiptsCents <= 0 || ratePercent <= 0) return 0;
  return Math.round((netReceiptsCents * ratePercent) / 100);
}

/**
 * Post a collection: relieve the receivables it settles, book the cash and the
 * creditable withholding tax, and (for non-VAT invoices) accrue percentage tax.
 */
export async function postCollectionTx(
  tx: Tx,
  collection: Collection,
  opts: PostCollectionOptions,
  orgId: string,
  userId: string,
): Promise<PostResult> {
  if (collection.bookingJournalEntryId) return { ok: false, error: "already_posted" };
  if (collection.status === VOIDED_STATUS || !POSTABLE_STATUSES.has(collection.status)) {
    return { ok: false, error: "not_postable" };
  }
  if (!opts.applications.length) return { ok: false, error: "no_applications" };

  const received = collection.amountReceivedCents;
  const ewt = collection.ewtCents;
  const relief = received + ewt;
  if (relief <= 0) return { ok: false, error: "nothing_to_post" };

  // The applications must account for exactly what the collection relieves —
  // otherwise the journal entry and the sub-ledger would disagree.
  const appliedTotal = opts.applications.reduce((s, a) => s + a.appliedCents, 0);
  const ewtTotal = opts.applications.reduce((s, a) => s + (a.ewtCents ?? 0), 0);
  if (appliedTotal !== received || ewtTotal !== ewt) {
    return {
      ok: false,
      error: "over_application",
      detail:
        `Applications must sum to the collection: applied ${appliedTotal} vs received ${received}, ` +
        `EWT ${ewtTotal} vs ${ewt}.`,
    };
  }

  const invoiceIds = opts.applications.map((a) => a.invoiceId);
  const invoices = await tx
    .select()
    .from(serviceInvoices)
    .where(and(eq(serviceInvoices.orgId, orgId), inArray(serviceInvoices.id, invoiceIds)));
  const byId = new Map(invoices.map((i) => [i.id, i]));

  let netReceiptsNonVat = 0;

  for (const app of opts.applications) {
    const inv = byId.get(app.invoiceId);
    if (!inv) return { ok: false, error: "invoice_not_issued", detail: `Unknown invoice ${app.invoiceId}.` };
    // Only an issued invoice has a receivable on the books to relieve.
    if (!inv.bookingJournalEntryId) {
      return { ok: false, error: "invoice_not_issued", detail: `Invoice ${inv.siNo} is not issued yet.` };
    }

    const thisRelief = app.appliedCents + (app.ewtCents ?? 0);
    const outstanding = inv.amountCents - inv.appliedCents;
    if (thisRelief > outstanding) {
      return {
        ok: false,
        error: "over_application",
        detail: `Invoice ${inv.siNo} has ${outstanding} centavos outstanding; cannot apply ${thisRelief}.`,
      };
    }

    // EWT base is the amount NET of VAT. Withholding is a percentage of that,
    // so the EWT on an invoice can never exceed its own net portion.
    if ((app.ewtCents ?? 0) > inv.netCents) {
      return {
        ok: false,
        error: "ewt_exceeds_net",
        detail:
          `EWT ${app.ewtCents} exceeds invoice ${inv.siNo}'s net of VAT (${inv.netCents}). ` +
          `Withholding is computed on the amount net of VAT, not the gross.`,
      };
    }

    // Percentage tax accrues only on non-VAT sales, on the NET share collected.
    if (inv.vatTreatment === "none") {
      netReceiptsNonVat += netShareOf(inv, thisRelief);
    }
  }

  // ── The cash entry ─────────────────────────────────────────────────────────
  const arCode = opts.arAccountCode || collection.arAccountCode || arCodeFromInvoices(invoices);
  const cashCode = opts.cashAccountCode || collection.cashAccountCode;
  const cwtCode = ewt > 0 ? opts.cwtAccountCode || collection.cwtAccountCode || DEFAULT_CWT_ACCOUNT : null;
  if (!cashCode) return { ok: false, error: "accounts_unset" };

  const byCode = await resolveAccountCodes(tx, orgId, [arCode, cashCode, cwtCode]);
  const arId = byCode.get(arCode);
  const cashId = byCode.get(cashCode);
  const cwtId = cwtCode ? byCode.get(cwtCode) : undefined;
  if (!arId || !cashId || (ewt > 0 && !cwtId)) return { ok: false, error: "accounts_unset" };

  const label = `${collection.contactName} (${collection.collectionNo})`;
  const entryDate = opts.date ?? collection.collectionDate;

  const je = await postJournalEntryCore(
    tx,
    {
      orgId,
      entryDate,
      memo: `Collection — ${label}`,
      entryType: "Manual",
      reference: collection.collectionNo,
      sourceType: "collection",
      sourceId: collection.id,
      post: true,
      lines: [
        ...(received > 0
          ? [{ accountId: cashId, debitCents: received, creditCents: 0, description: `Cash — ${label}` }]
          : []),
        ...(ewt > 0 && cwtId
          ? [{ accountId: cwtId, debitCents: ewt, creditCents: 0, description: `CWT withheld — ${label}` }]
          : []),
        { accountId: arId, debitCents: 0, creditCents: relief, description: `Receivable settled — ${label}` },
      ],
    },
    { userId, orgId },
  );

  // ── Percentage tax accrual (non-VAT receipts only), a separate entry ───────
  let ptEntryNo: string | undefined;
  let ptCents = 0;
  let ptRate = 0;
  if (netReceiptsNonVat > 0) {
    ptRate = await resolvePercentageTaxRate(tx, orgId);
    ptCents = percentageTaxOn(netReceiptsNonVat, ptRate);
    if (ptCents > 0) {
      const ptCodes = await resolveAccountCodes(tx, orgId, [
        DEFAULT_TAXES_AND_LICENSES,
        DEFAULT_PERCENTAGE_TAX_PAYABLE,
      ]);
      const expenseId = ptCodes.get(DEFAULT_TAXES_AND_LICENSES);
      const payableId = ptCodes.get(DEFAULT_PERCENTAGE_TAX_PAYABLE);
      if (!expenseId || !payableId) return { ok: false, error: "accounts_unset" };

      const pt = await postJournalEntryCore(
        tx,
        {
          orgId,
          entryDate,
          memo: `Percentage tax (Sec. 116) ${ptRate}% — ${label}`,
          entryType: "Manual",
          reference: collection.collectionNo,
          sourceType: "collection_percentage_tax",
          sourceId: collection.id,
          post: true,
          lines: [
            { accountId: expenseId, debitCents: ptCents, creditCents: 0, description: "Percentage tax" },
            { accountId: payableId, debitCents: 0, creditCents: ptCents, description: "Percentage tax payable" },
          ],
        },
        { userId, orgId },
      );
      ptEntryNo = pt.entryNo;
    }
  }

  // ── Record the applications and roll the invoice balances forward ──────────
  await tx.insert(collectionApplications).values(
    opts.applications.map((a) => ({
      orgId,
      collectionId: collection.id,
      invoiceId: a.invoiceId,
      appliedCents: a.appliedCents,
      ewtCents: a.ewtCents ?? 0,
      createdBy: userId,
    })),
  );

  for (const a of opts.applications) {
    await tx
      .update(serviceInvoices)
      .set({ appliedCents: sql`${serviceInvoices.appliedCents} + ${a.appliedCents + (a.ewtCents ?? 0)}` })
      .where(eq(serviceInvoices.id, a.invoiceId));
  }

  const [updated] = await tx
    .update(collections)
    .set({
      status: POSTED_STATUS,
      bookingJournalEntryId: je.id,
      bookedAt: new Date(),
      bookingMode: "collection",
      appliedCents: appliedTotal,
      arAccountCode: arCode,
      cashAccountCode: cashCode,
      cwtAccountCode: cwtCode,
      percentageTaxCents: ptCents,
      percentageTaxRate: String(ptRate),
      percentageTaxJournalEntryId: ptEntryNo ? (await entryIdOf(tx, orgId, ptEntryNo)) : null,
      postedBy: userId,
      postedAt: new Date().toISOString(),
    })
    .where(eq(collections.id, collection.id))
    .returning();

  return {
    ok: true,
    collection: updated!,
    journalEntryNo: je.entryNo,
    ...(ptEntryNo ? { percentageTaxEntryNo: ptEntryNo } : {}),
    applications: opts.applications.map((a) => ({
      invoiceId: a.invoiceId,
      siNo: byId.get(a.invoiceId)!.siNo,
      appliedCents: a.appliedCents,
      ewtCents: a.ewtCents ?? 0,
    })),
  };
}

/**
 * The VAT-exclusive share of a relief amount against an invoice.
 *
 * A partial settlement clears net and VAT in the same ratio as the invoice, so
 * the percentage-tax base tracks the portion of income actually received.
 * Integer maths: multiply first, divide once.
 */
function netShareOf(invoice: Invoice, reliefCents: number): number {
  if (invoice.amountCents <= 0) return 0;
  if (reliefCents >= invoice.amountCents) return invoice.netCents;
  return Math.round((invoice.netCents * reliefCents) / invoice.amountCents);
}

/** AR account to credit: whatever the settled invoices were posted against. */
function arCodeFromInvoices(invoices: readonly Invoice[]): string {
  const codes = [...new Set(invoices.map((i) => i.arAccountCode).filter((c): c is string => !!c))];
  return codes.length === 1 ? codes[0]! : DEFAULT_AR_ACCOUNT;
}

async function entryIdOf(tx: Tx, orgId: string, entryNo: string): Promise<string | null> {
  const rows = (await tx.execute(
    sql`SELECT id FROM journal_entries WHERE org_id = ${orgId} AND entry_no = ${entryNo} LIMIT 1`,
  )) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export type VoidResult =
  | { collection: Collection }
  | { error: "not_found" | "already_voided" | "not_posted" };

/**
 * Void a posted collection: reverse both entries, roll the invoice balances
 * back, and drop the applications. Originals are never mutated.
 */
export async function voidCollectionTx(
  tx: Tx,
  collection: Collection,
  orgId: string,
  userId: string,
): Promise<VoidResult> {
  if (collection.status === VOIDED_STATUS) return { error: "already_voided" };
  if (!collection.bookingJournalEntryId) return { error: "not_posted" };

  await reverseJournalEntryCore(tx, collection.bookingJournalEntryId, { userId, orgId });
  if (collection.percentageTaxJournalEntryId) {
    await reverseJournalEntryCore(tx, collection.percentageTaxJournalEntryId, { userId, orgId });
  }

  const apps = await tx
    .select()
    .from(collectionApplications)
    .where(
      and(
        eq(collectionApplications.orgId, orgId),
        eq(collectionApplications.collectionId, collection.id),
      ),
    );

  for (const a of apps) {
    await tx
      .update(serviceInvoices)
      .set({ appliedCents: sql`${serviceInvoices.appliedCents} - ${a.appliedCents + a.ewtCents}` })
      .where(eq(serviceInvoices.id, a.invoiceId));
  }

  await tx
    .delete(collectionApplications)
    .where(
      and(
        eq(collectionApplications.orgId, orgId),
        eq(collectionApplications.collectionId, collection.id),
      ),
    );

  const [updated] = await tx
    .update(collections)
    .set({
      status: VOIDED_STATUS,
      bookingJournalEntryId: null,
      percentageTaxJournalEntryId: null,
      bookedAt: null,
      bookingMode: null,
      appliedCents: 0,
    })
    .where(eq(collections.id, collection.id))
    .returning();

  return { collection: updated! };
}
