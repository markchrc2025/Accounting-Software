/**
 * Service invoice → General Ledger (M2.1).
 *
 * Issuing an invoice posts its revenue entry through `postJournalEntryCore()` —
 * the one ledger writer. Cancelling reverses through `reverseJournalEntryCore()`.
 * No invoice edit ever mutates a posted entry.
 *
 * ── The templates ─────────────────────────────────────────────────────────────
 * With net = VAT-exclusive base, vat = output VAT, gross = net + vat:
 *
 *   T1  vatable                DR Trade Receivable   gross
 *                                  CR Revenue          net
 *                                  CR Output Tax       vat
 *
 *   T2  none (non-VAT)         DR Trade Receivable   net
 *                                  CR Revenue          net
 *
 *   T3  exempt / zero_rated    DR Trade Receivable   net
 *                                  CR Revenue          net
 *
 * T2 and T3 are the SAME entry. That is correct and deliberate: the difference
 * is not an accounting one, it is a VAT-return one (exempt vs zero-rated vs
 * non-VAT split differently on 2550Q, and only 'none' accrues percentage tax on
 * collection). So the distinction lives on the invoice in `vatTreatment`, not
 * in the ledger — you cannot recover it from the journal entry.
 *
 * T2 posts NO tax line. Percentage tax under Sec. 116 is the SELLER's expense,
 * not something billed to or withheld from the client, and it is recognised
 * against receipts — so it belongs to collection (M2.2), not issuance.
 *
 * VAT basis is ACCRUAL AT ISSUANCE (RA 11976 / EOPT). Output VAT is credited
 * here, on billing, not deferred until collection.
 */
import { eq } from "drizzle-orm";
import { serviceInvoices, type Tx } from "@sentire-books/db";
import type { ServiceInvoiceIssue } from "@sentire-books/domain";
import { postJournalEntryCore, reverseJournalEntryCore } from "./postJournalEntry";
import { resolveAccountCodes } from "./resolveAccounts";

/** Status an issued (posted) invoice carries. */
export const ISSUED_STATUS = "Issued";
/** Status a cancelled invoice carries. */
export const CANCELLED_STATUS = "Cancelled";
/** Statuses an invoice may be issued FROM. */
const ISSUABLE_STATUSES = new Set(["Draft", "Approved", "Pending", "For Approval"]);

/** Fallbacks when neither the invoice nor the customer names an account. */
export const DEFAULT_AR_ACCOUNT = "1001022"; // Trade Receivable - Client
export const DEFAULT_OUTPUT_VAT_ACCOUNT = "2003003"; // Output Tax

type Invoice = typeof serviceInvoices.$inferSelect;

export type IssueFailure =
  | "already_issued"
  | "not_draft"
  | "nothing_to_issue"
  | "accounts_unset"
  | "vat_account_unset";

export interface IssueLine {
  accountCode: string;
  debitCents: number;
  creditCents: number;
  description: string;
}

export type IssueResult =
  | { ok: true; invoice: Invoice; journalEntryNo: string; lines: IssueLine[] }
  | { ok: false; error: IssueFailure };

export interface IssueOptions extends ServiceInvoiceIssue {
  /** The customer contact's own AR sub-account, when they have one. */
  contactArAccountCode?: string | null;
}

/**
 * Resolution order for the receivable account, most specific first:
 *   explicit override on this request → the invoice's own snapshot →
 *   the customer contact's AR sub-account → the chart's AR control account.
 *
 * The contact hop is what makes per-client receivables (DO101…DO129) work
 * without the caller having to know about them.
 */
function pickArAccount(invoice: Invoice, opts: IssueOptions): string {
  return (
    opts.arAccountCode ||
    invoice.arAccountCode ||
    opts.contactArAccountCode ||
    DEFAULT_AR_ACCOUNT
  );
}

/**
 * Post an invoice's issuance entry inside an existing transaction and stamp the
 * invoice. Shared by the route and (later) any bulk-issue path.
 */
export async function issueInvoiceTx(
  tx: Tx,
  invoice: Invoice,
  opts: IssueOptions,
  orgId: string,
  userId: string,
): Promise<IssueResult> {
  if (invoice.bookingJournalEntryId) return { ok: false, error: "already_issued" };
  if (invoice.status === CANCELLED_STATUS || !ISSUABLE_STATUSES.has(invoice.status)) {
    return { ok: false, error: "not_draft" };
  }

  const net = invoice.netCents;
  const vat = invoice.vatCents;
  const gross = net + vat;
  if (gross <= 0) return { ok: false, error: "nothing_to_issue" };

  const vatable = invoice.vatTreatment === "vatable" && vat > 0;

  const arCode = pickArAccount(invoice, opts);
  const incomeCode = opts.incomeAccountCode || invoice.incomeAccountCode;
  const vatCode = vatable
    ? opts.outputVatAccountCode || invoice.outputVatAccountCode || DEFAULT_OUTPUT_VAT_ACCOUNT
    : null;

  // No income account is a real configuration gap, not something to guess at —
  // picking a revenue account for the user would silently misclassify income.
  if (!incomeCode) return { ok: false, error: "accounts_unset" };

  // Fail-closed on duplicate codes (M2.0).
  const byCode = await resolveAccountCodes(tx, orgId, [arCode, incomeCode, vatCode]);
  const arId = byCode.get(arCode);
  const incomeId = byCode.get(incomeCode);
  if (!arId || !incomeId) return { ok: false, error: "accounts_unset" };

  const vatId = vatCode ? byCode.get(vatCode) : undefined;
  if (vatable && !vatId) return { ok: false, error: "vat_account_unset" };

  const label = `${invoice.contactName} (${invoice.siNo})`;
  const lines = [
    { accountId: arId, debitCents: gross, creditCents: 0, description: `Receivable — ${label}` },
    { accountId: incomeId, debitCents: 0, creditCents: net, description: `Revenue — ${label}` },
    ...(vatable && vatId
      ? [{ accountId: vatId, debitCents: 0, creditCents: vat, description: `Output VAT — ${label}` }]
      : []),
  ];

  const entryDate = opts.date ?? invoice.siDate;
  const je = await postJournalEntryCore(
    tx,
    {
      orgId,
      entryDate,
      memo: `Invoice — ${label}`,
      entryType: "Manual",
      reference: invoice.siNo,
      sourceType: "service_invoice",
      sourceId: invoice.id,
      post: true,
      lines,
    },
    { userId, orgId },
  );

  const [updated] = await tx
    .update(serviceInvoices)
    .set({
      status: ISSUED_STATUS,
      bookingJournalEntryId: je.id,
      bookedAt: new Date(),
      bookingMode: invoice.vatTreatment,
      // Snapshot what we actually posted to, so a later contact edit cannot
      // retroactively move this invoice's history to a different account.
      arAccountCode: arCode,
      incomeAccountCode: incomeCode,
      outputVatAccountCode: vatCode,
    })
    .where(eq(serviceInvoices.id, invoice.id))
    .returning();

  return {
    ok: true,
    invoice: updated!,
    journalEntryNo: je.entryNo,
    lines: [
      { accountCode: arCode, debitCents: gross, creditCents: 0, description: "Trade Receivable" },
      { accountCode: incomeCode, debitCents: 0, creditCents: net, description: "Revenue" },
      ...(vatable && vatCode
        ? [{ accountCode: vatCode, debitCents: 0, creditCents: vat, description: "Output VAT" }]
        : []),
    ],
  };
}

export type CancelResult =
  | { invoice: Invoice }
  | { error: "not_found" | "already_cancelled" | "has_collections" };

/**
 * Cancel an invoice: reverse its issuance entry (if issued) and mark it
 * Cancelled. The original entry is never mutated — invariant #2.
 */
export async function cancelInvoiceTx(
  tx: Tx,
  invoice: Invoice,
  orgId: string,
  userId: string,
): Promise<CancelResult> {
  if (invoice.status === CANCELLED_STATUS) return { error: "already_cancelled" };

  // A collection has already relieved part of this receivable; cancelling
  // underneath it would strand the cash entry against nothing. M2.2 tightens
  // this to the applications table once collections post to the GL.
  if (invoice.appliedCents > 0) return { error: "has_collections" };

  if (invoice.bookingJournalEntryId) {
    await reverseJournalEntryCore(tx, invoice.bookingJournalEntryId, { userId, orgId });
  }

  const [updated] = await tx
    .update(serviceInvoices)
    .set({
      status: CANCELLED_STATUS,
      bookingJournalEntryId: null,
      bookedAt: null,
      bookingMode: null,
    })
    .where(eq(serviceInvoices.id, invoice.id))
    .returning();

  return { invoice: updated! };
}
