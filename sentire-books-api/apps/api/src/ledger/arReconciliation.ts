/**
 * AR sub-ledger ⇄ GL reconciliation (M2.3).
 *
 * Mirrors `GET /loans/reconciliation`: the sub-ledger and the general ledger are
 * two independent records of the same receivable, and this proves they agree —
 * or names exactly what explains the gap.
 *
 * ── The identity ─────────────────────────────────────────────────────────────
 *
 *     residual = glControl − (arSubLedger − unissuedInvoices + unpostedCollections)
 *
 *   glControl           posted debit balance of the AR accounts in use
 *   arSubLedger         Σ (amount − applied) over live invoices — what the
 *                       sub-ledger says customers still owe
 *   unissuedInvoices    Draft invoices. The sub-ledger counts them, the GL has
 *                       never seen them → subtract.
 *   unpostedCollections Collections not yet posted. The sub-ledger has already
 *                       netted them off (no — see below) …
 *
 * Careful with that last one: an UNPOSTED collection has no
 * `collection_applications` rows, so it has NOT reduced any invoice's
 * `applied_cents`. It is therefore invisible to `arSubLedger` too, and adding it
 * back would double-count. What it represents is cash in hand that the books do
 * not yet reflect on EITHER side — so it is reported as an explanatory figure,
 * not a term in the identity.
 *
 * The identity that actually holds is:
 *
 *     residual = glControl − (arSubLedger − unissuedInvoices)
 *
 * `residual ≠ 0` means the GL moved in a way the sub-ledger cannot explain —
 * a manual journal entry against a receivable account, most likely. That is
 * exactly the drift this tile exists to surface.
 */
import { and, eq, sql } from "drizzle-orm";
import { serviceInvoices, collections, type Tx } from "@sentire-books/db";
import { DEFAULT_AR_ACCOUNT } from "./postInvoice";

/** Invoice statuses that are not live receivables. */
const DEAD_INVOICE_STATUSES = ["Cancelled", "Voided", "Rejected"];
/** Collection statuses that will never post. */
const DEAD_COLLECTION_STATUSES = ["Voided", "Cancelled", "Rejected"];

export interface ArReconciliation {
  glControlCents: number;
  arSubLedgerCents: number;
  unissuedCents: number;
  unpostedCollectionCents: number;
  residualCents: number;
  reconciled: boolean;
  arAccountCodes: string[];
  unissuedInvoices: Array<{
    id: string;
    siNo: string;
    contactName: string;
    outstandingCents: number;
    status: string;
  }>;
  unpostedCollections: Array<{
    id: string;
    collectionNo: string;
    contactName: string;
    reliefCents: number;
    status: string;
  }>;
}

/**
 * Reconcile the AR sub-ledger against the GL control account(s).
 *
 * Runs inside the caller's transaction so it sees a consistent snapshot — a
 * collection posting mid-read would otherwise make the two sides disagree for
 * reasons that have nothing to do with drift.
 */
export async function arReconciliation(tx: Tx, orgId: string): Promise<ArReconciliation> {
  const invoices = await tx
    .select()
    .from(serviceInvoices)
    .where(eq(serviceInvoices.orgId, orgId));

  const live = invoices.filter((i) => !DEAD_INVOICE_STATUSES.includes(i.status));

  // Which accounts the GL side should look at: every account issued invoices
  // were actually posted against, plus the control account as a floor. Reading
  // the snapshot (not the contact) is what makes this stable over time.
  const arCodes = [
    ...new Set([
      ...live.map((i) => i.arAccountCode).filter((c): c is string => !!c),
      DEFAULT_AR_ACCOUNT,
    ]),
  ].sort();

  let glControlCents = 0;
  if (arCodes.length) {
    const codeList = sql.join(
      arCodes.map((c) => sql`${c}`),
      sql`, `,
    );
    const rows = (await tx.execute(sql`
      SELECT COALESCE(SUM(debit_cents - credit_cents), 0)::bigint AS control
      FROM v_account_postings
      WHERE org_id = ${orgId} AND account_code IN (${codeList})
    `)) as unknown as Array<{ control: string }>;
    glControlCents = Number(rows[0]?.control ?? 0);
  }

  // Sub-ledger: what customers still owe, per the invoice records.
  const arSubLedgerCents = live.reduce((s, i) => s + (i.amountCents - i.appliedCents), 0);

  // Invoices the GL has never seen — they inflate the sub-ledger side.
  const unissued = live.filter((i) => !i.bookingJournalEntryId);
  const unissuedInvoices = unissued.map((i) => ({
    id: i.id,
    siNo: i.siNo,
    contactName: i.contactName,
    outstandingCents: i.amountCents - i.appliedCents,
    status: i.status,
  }));
  const unissuedCents = unissuedInvoices.reduce((s, i) => s + i.outstandingCents, 0);

  // Cash received but not yet posted. Explanatory only — an unposted collection
  // has no applications, so it has not moved either side of the identity.
  const collectionRows = await tx
    .select()
    .from(collections)
    .where(eq(collections.orgId, orgId));
  const unposted = collectionRows.filter(
    (c) => !c.bookingJournalEntryId && !DEAD_COLLECTION_STATUSES.includes(c.status),
  );
  const unpostedCollections = unposted.map((c) => ({
    id: c.id,
    collectionNo: c.collectionNo,
    contactName: c.contactName,
    reliefCents: c.arReliefCents ?? c.amountReceivedCents + c.ewtCents,
    status: c.status,
  }));
  const unpostedCollectionCents = unpostedCollections.reduce((s, c) => s + c.reliefCents, 0);

  const residualCents = glControlCents - (arSubLedgerCents - unissuedCents);

  return {
    glControlCents,
    arSubLedgerCents,
    unissuedCents,
    unpostedCollectionCents,
    residualCents,
    // "Reconciled" is the strong claim: nothing pending AND no drift.
    reconciled: unissuedCents === 0 && unpostedCollectionCents === 0 && residualCents === 0,
    arAccountCodes: arCodes,
    unissuedInvoices,
    unpostedCollections,
  };
}

/**
 * Per-invoice outstanding balances for a set of AR accounts — the shared basis
 * for both the reconciliation and the aging report, so the two cannot disagree
 * about what is outstanding.
 */
export async function outstandingInvoices(tx: Tx, orgId: string, onlyIssued = true) {
  const rows = await tx
    .select()
    .from(serviceInvoices)
    .where(
      and(
        eq(serviceInvoices.orgId, orgId),
        sql`${serviceInvoices.status} NOT IN (${sql.join(
          DEAD_INVOICE_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      ),
    );
  return rows
    .filter((i) => (onlyIssued ? !!i.bookingJournalEntryId : true))
    .map((i) => ({
      id: i.id,
      siNo: i.siNo,
      contactId: i.contactId,
      contactName: i.contactName,
      siDate: i.siDate,
      dueDate: i.dueDate,
      arAccountCode: i.arAccountCode,
      amountCents: i.amountCents,
      appliedCents: i.appliedCents,
      outstandingCents: i.amountCents - i.appliedCents,
    }))
    .filter((i) => i.outstandingCents !== 0);
}

export { DEAD_INVOICE_STATUSES };
export type OutstandingInvoice = Awaited<ReturnType<typeof outstandingInvoices>>[number];
