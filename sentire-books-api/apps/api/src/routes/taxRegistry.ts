/**
 * Tax registry report (M2.5).
 *
 * Replaces the portal's client-side derivation, which had two defects:
 *
 *   1. TRUNCATION. `TaxPage.jsx` fetched 500 vouchers, filtered to
 *      Payment/Check, then took `.slice(0, 50)`. Anything older silently
 *      vanished — the page said "N tax lines" and meant "N of the 50 most
 *      recent vouchers I happened to hydrate". A tax report that quietly
 *      omits periods is worse than no tax report.
 *
 *   2. N+1. It then issued one `getVoucher()` request per voucher to pull the
 *      lines — up to 50 sequential round trips on every page load.
 *
 * Both collapse into one query here. And because output VAT now exists on the
 * ledger (M2.1), the report finally has a SALES side: previously it could only
 * ever show input tax from disbursements, which is half a VAT position.
 *
 * Purchases (input tax) come from voucher-line `meta`, where the tax picker
 * records what the user chose. Sales (output tax) come from issued invoices,
 * whose `vat_cents` is DB-constrained to equal `amount − net`.
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  withOrgContext,
  vouchers,
  voucherLines,
  contacts,
  serviceInvoices,
  type Tx,
} from "@sentire-books/db";
import { requireAuth } from "../auth";
import { reportError } from "../observability";

export const taxRegistryRoutes = new Hono();

/** Voucher types that carry a creditable input tax. */
const PURCHASE_VOUCHER_TYPES = ["payment", "check"] as const;
/** Voucher statuses that represent a real, non-void transaction. */
const LIVE_VOUCHER_STATUSES = [
  "pending",
  "for_verification",
  "verified",
  "for_approval",
  "approved",
  "for_disbursement",
  "paid",
  "posted",
] as const;
/** Invoice statuses that are not live sales. */
const DEAD_INVOICE_STATUSES = ["Cancelled", "Voided", "Rejected"] as const;

export interface TaxLine {
  key: string;
  side: "purchase" | "sale";
  date: string;
  period: string; // YYYY-MM
  documentNo: string;
  source: string;
  counterparty: string;
  description: string;
  taxName: string;
  taxRate: number;
  grossCents: number;
  taxCents: number;
  inclusive: boolean;
  status: string;
}

export interface TaxRegistry {
  from: string | null;
  to: string | null;
  lines: TaxLine[];
  totals: {
    outputTaxCents: number;
    inputTaxCents: number;
    netVatPayableCents: number;
    salesGrossCents: number;
    purchasesGrossCents: number;
  };
  byPeriod: Array<{
    period: string;
    outputTaxCents: number;
    inputTaxCents: number;
    netVatPayableCents: number;
  }>;
  /** True when the whole ledger is covered — i.e. no date filter was applied. */
  complete: boolean;
  counts: { purchases: number; sales: number };
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

/** Money in the voucher meta is in PESOS (the picker's units); convert once. */
const pesosToCents = (v: unknown): number => Math.round(num(v) * 100);

/**
 * Build the registry. `from`/`to` are inclusive ISO dates; omitting both covers
 * every period — there is no row cap.
 */
export async function taxRegistry(
  tx: Tx,
  orgId: string,
  from: string | null,
  to: string | null,
): Promise<TaxRegistry> {
  // ── Purchases: one join, no N+1, no cap ───────────────────────────────────
  const purchaseRows = await tx
    .select({
      voucherId: vouchers.id,
      voucherNo: vouchers.voucherNo,
      voucherType: vouchers.voucherType,
      voucherDate: vouchers.voucherDate,
      status: vouchers.status,
      purposeCategory: vouchers.purposeCategory,
      meta: vouchers.meta,
      contactName: contacts.name,
      lineNo: voucherLines.lineNo,
      lineDescription: voucherLines.description,
      amountCents: voucherLines.amountCents,
      lineMeta: voucherLines.meta,
    })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .leftJoin(contacts, eq(contacts.id, vouchers.contactId))
    .where(
      and(
        eq(vouchers.orgId, orgId),
        sql`${vouchers.voucherType} IN (${sql.join(
          PURCHASE_VOUCHER_TYPES.map((t) => sql`${t}`),
          sql`, `,
        )})`,
        sql`${vouchers.status} IN (${sql.join(
          LIVE_VOUCHER_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        ...(from ? [gte(vouchers.voucherDate, from)] : []),
        ...(to ? [lte(vouchers.voucherDate, to)] : []),
      ),
    );

  const lines: TaxLine[] = [];

  for (const r of purchaseRows) {
    const lm = (r.lineMeta ?? {}) as Record<string, unknown>;
    const taxCents = pesosToCents(lm.taxAmt);
    if (taxCents <= 0) continue; // only lines that actually carry tax

    const vm = (r.meta ?? {}) as Record<string, unknown>;
    const date = r.voucherDate;
    lines.push({
      key: `v:${r.voucherId}:${r.lineNo}`,
      side: "purchase",
      date,
      period: date.slice(0, 7),
      documentNo: r.voucherNo,
      source: r.voucherType === "check" ? "Check Voucher" : "Payment Voucher",
      counterparty:
        (typeof lm.contact === "string" && lm.contact) ||
        r.contactName ||
        (typeof vm.contactSummary === "string" ? vm.contactSummary : "") ||
        "",
      description: r.lineDescription ?? r.purposeCategory ?? "",
      taxName: typeof lm.taxType === "string" ? lm.taxType : "",
      taxRate: num(lm.taxRate),
      grossCents: r.amountCents,
      taxCents,
      inclusive: !!lm.inclusive,
      status: r.status,
    });
  }

  // ── Sales: output VAT from issued invoices (new in M2.5) ──────────────────
  const saleRows = await tx
    .select()
    .from(serviceInvoices)
    .where(
      and(
        eq(serviceInvoices.orgId, orgId),
        sql`${serviceInvoices.status} NOT IN (${sql.join(
          DEAD_INVOICE_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )})`,
        sql`${serviceInvoices.bookingJournalEntryId} IS NOT NULL`,
        ...(from ? [gte(serviceInvoices.siDate, from)] : []),
        ...(to ? [lte(serviceInvoices.siDate, to)] : []),
      ),
    );

  for (const inv of saleRows) {
    if (inv.vatCents <= 0) continue;
    lines.push({
      key: `i:${inv.id}`,
      side: "sale",
      date: inv.siDate,
      period: inv.siDate.slice(0, 7),
      documentNo: inv.siNo,
      source: "Service Invoice",
      counterparty: inv.contactName,
      description: inv.notes ?? "",
      taxName: "Output VAT",
      // Derived from the amounts themselves rather than a stored rate, so it
      // stays truthful even if a tenant invoices at a non-standard rate.
      taxRate: inv.netCents > 0 ? Math.round((inv.vatCents / inv.netCents) * 10000) / 100 : 0,
      grossCents: inv.netCents,
      taxCents: inv.vatCents,
      inclusive: false,
      status: inv.status,
    });
  }

  lines.sort((a, b) => b.date.localeCompare(a.date) || a.documentNo.localeCompare(b.documentNo));

  const outputTaxCents = lines.filter((l) => l.side === "sale").reduce((s, l) => s + l.taxCents, 0);
  const inputTaxCents = lines.filter((l) => l.side === "purchase").reduce((s, l) => s + l.taxCents, 0);
  const salesGrossCents = lines.filter((l) => l.side === "sale").reduce((s, l) => s + l.grossCents, 0);
  const purchasesGrossCents = lines
    .filter((l) => l.side === "purchase")
    .reduce((s, l) => s + l.grossCents, 0);

  const periods = new Map<string, { outputTaxCents: number; inputTaxCents: number }>();
  for (const l of lines) {
    const p = periods.get(l.period) ?? { outputTaxCents: 0, inputTaxCents: 0 };
    if (l.side === "sale") p.outputTaxCents += l.taxCents;
    else p.inputTaxCents += l.taxCents;
    periods.set(l.period, p);
  }

  return {
    from,
    to,
    lines,
    totals: {
      outputTaxCents,
      inputTaxCents,
      // The VAT position: output less creditable input. Negative = a credit
      // carried forward, which is a real and common outcome.
      netVatPayableCents: outputTaxCents - inputTaxCents,
      salesGrossCents,
      purchasesGrossCents,
    },
    byPeriod: [...periods.entries()]
      .map(([period, v]) => ({
        period,
        ...v,
        netVatPayableCents: v.outputTaxCents - v.inputTaxCents,
      }))
      .sort((a, b) => b.period.localeCompare(a.period)),
    complete: !from && !to,
    counts: {
      purchases: lines.filter((l) => l.side === "purchase").length,
      sales: lines.filter((l) => l.side === "sale").length,
    },
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /reports/tax-registry?from=&to=`
 *
 * Every period is covered when no range is given — there is no row cap, and
 * `complete` says so explicitly rather than leaving the caller to guess.
 */
taxRegistryRoutes.get("/tax-registry", requireAuth, async (c) => {
  const auth = c.get("auth");
  const from = c.req.query("from") ?? null;
  const to = c.req.query("to") ?? null;
  for (const [name, v] of [
    ["from", from],
    ["to", to],
  ] as const) {
    if (v && !ISO_DATE.test(v)) {
      return c.json({ error: "validation_error", detail: `${name} must be YYYY-MM-DD.` }, 400);
    }
  }
  if (from && to && from > to) {
    return c.json({ error: "validation_error", detail: "from must not be after to." }, 400);
  }
  try {
    const result = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) => taxRegistry(tx, auth.orgId, from, to),
    );
    return c.json(result);
  } catch (err) {
    reportError(c, "taxRegistry", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
