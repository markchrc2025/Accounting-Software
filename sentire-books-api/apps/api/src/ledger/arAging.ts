/**
 * AR Aging (M2.4).
 *
 * Buckets outstanding receivables by how long they have been overdue, per
 * customer, as of a chosen date.
 *
 * The property that makes this report trustworthy, and which M2.4's acceptance
 * check asserts:
 *
 *     aging total  ==  AR sub-ledger outstanding  ==  GL control (when reconciled)
 *
 * It holds by construction, not by coincidence: aging reads the SAME
 * `outstandingInvoices()` helper the reconciliation uses, so the two cannot
 * disagree about what is outstanding. A report that quietly diverges from the
 * control account is worse than no report.
 *
 * ── Bucketing ────────────────────────────────────────────────────────────────
 * Age is measured from the DUE date, not the invoice date — an invoice on Net
 * 30 is not overdue on day 1. Invoices with no due date fall back to the
 * invoice date, which is the conservative reading (they were due on receipt).
 *
 *   Current   not yet due  (dueDate >= asOf)
 *   1-30      1 to 30 days past due
 *   31-60
 *   61-90
 *   90+       more than 90 days past due
 */
import type { Tx } from "@sentire-books/db";
import { outstandingInvoices, type OutstandingInvoice } from "./arReconciliation";

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Human labels, for the portal and for CSV headers. */
export const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  d1_30: "1–30",
  d31_60: "31–60",
  d61_90: "61–90",
  d90_plus: "90+",
};

export interface AgingRow {
  contactId: string | null;
  contactName: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  totalCents: number;
  invoices: Array<{
    id: string;
    siNo: string;
    siDate: string;
    dueDate: string | null;
    daysPastDue: number;
    bucket: AgingBucket;
    outstandingCents: number;
  }>;
}

export interface ArAging {
  asOf: string;
  totals: Record<AgingBucket, number> & { totalCents: number };
  rows: AgingRow[];
  invoiceCount: number;
}

/** Whole days between two ISO dates, positive when `date` is before `asOf`. */
export function daysPastDue(dueDate: string, asOf: string): number {
  const MS_PER_DAY = 86_400_000;
  // Parse as UTC midnight so DST never shifts a boundary by a day.
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const at = Date.parse(`${asOf}T00:00:00Z`);
  return Math.floor((at - due) / MS_PER_DAY);
}

/**
 * Which bucket an age falls in. Boundaries are inclusive at the top, so day 30
 * is "1–30" and day 31 opens "31–60" — no invoice can land in two buckets and
 * none can fall between them.
 */
export function bucketFor(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

/** The date an invoice becomes overdue: its due date, else its invoice date. */
function effectiveDueDate(invoice: OutstandingInvoice): string {
  return invoice.dueDate ?? invoice.siDate;
}

/**
 * Build the aging report as of `asOf` (ISO date, defaults to today).
 *
 * Only ISSUED invoices are aged: a Draft invoice has no receivable on the books,
 * so including it would break the equality with the GL control account.
 */
export async function arAging(tx: Tx, orgId: string, asOf: string): Promise<ArAging> {
  const invoices = await outstandingInvoices(tx, orgId, true);

  const byContact = new Map<string, AgingRow>();
  const totals = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    totalCents: 0,
  };

  for (const inv of invoices) {
    const due = effectiveDueDate(inv);
    const days = daysPastDue(due, asOf);
    const bucket = bucketFor(days);

    // Group by contact id when there is one; otherwise by the name as typed,
    // so free-text customers still aggregate instead of each becoming a row.
    const key = inv.contactId ?? `name:${inv.contactName}`;
    let row = byContact.get(key);
    if (!row) {
      row = {
        contactId: inv.contactId,
        contactName: inv.contactName,
        current: 0,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90_plus: 0,
        totalCents: 0,
        invoices: [],
      };
      byContact.set(key, row);
    }

    row[bucket] += inv.outstandingCents;
    row.totalCents += inv.outstandingCents;
    totals[bucket] += inv.outstandingCents;
    totals.totalCents += inv.outstandingCents;

    row.invoices.push({
      id: inv.id,
      siNo: inv.siNo,
      siDate: inv.siDate,
      dueDate: inv.dueDate,
      daysPastDue: Math.max(0, days),
      bucket,
      outstandingCents: inv.outstandingCents,
    });
  }

  const rows = [...byContact.values()].sort(
    (a, b) => b.totalCents - a.totalCents || a.contactName.localeCompare(b.contactName),
  );
  for (const r of rows) r.invoices.sort((a, b) => a.siDate.localeCompare(b.siDate));

  return { asOf, totals, rows, invoiceCount: invoices.length };
}
