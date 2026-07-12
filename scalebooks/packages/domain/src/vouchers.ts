/**
 * Vouchers — a payment or receipt that maps to a balanced journal entry.
 *
 *   payment: pay a vendor   → DEBIT the expense/AP line accounts, CREDIT cash
 *   receipt: receive money  → CREDIT the income/AR line accounts, DEBIT cash
 *
 * `buildVoucherJournalLines` produces JE lines that balance by construction
 * (the cash side always equals the sum of the detail lines), which is unit-tested.
 */
import { z } from "zod";
import { sum, type Centavos } from "./money";
import type { JournalLineInput } from "./journal";

export const VOUCHER_TYPES = [
  "payment",
  "receipt",
  "payroll",
  "final_pay",
  "loan",
  "check",
] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

/** Per-type document-number prefixes (PV202607-0001, PR202607-0001, …). */
export const VOUCHER_PREFIX: Readonly<Record<VoucherType, string>> = {
  payment: "PV",
  receipt: "RV",
  payroll: "PR",
  final_pay: "FP",
  loan: "LV",
  check: "CHK",
};

export const VOUCHER_STATUSES = [
  "draft",
  "pending",
  "for_verification",
  "verified",
  "for_approval",
  "approved",
  "for_disbursement", // parked in a disbursement report (managed by that module)
  "paid",
  "rejected",
  "posted",
  "void",
] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/**
 * Approval workflow. 'approved' is the ledger event (the JE posts from the
 * voucher's stored lines); 'void' is reached via the dedicated void endpoint
 * (which reverses the JE when one exists), not a plain transition.
 */
export const VOUCHER_TRANSITIONS: Readonly<Record<string, readonly VoucherStatus[]>> = {
  draft: ["pending", "for_verification"],
  pending: ["for_verification", "rejected", "draft"],
  for_verification: ["verified", "rejected"],
  verified: ["for_approval", "rejected"],
  for_approval: ["approved", "rejected"],
  approved: ["paid"],
  rejected: ["draft"],
};

export const VOUCHER_EDITABLE_STATUSES: readonly VoucherStatus[] = [
  "draft",
  "pending",
  "rejected",
];
export const VOUCHER_DELETABLE_STATUSES: readonly VoucherStatus[] = ["draft", "rejected"];

export const zVoucherLineInput = z.object({
  accountId: z.string().uuid(),
  description: z.string().max(500).optional(),
  amountCents: z.number().int().positive("Line amount must be greater than zero"),
});

export type VoucherLineInput = z.infer<typeof zVoucherLineInput>;

export const zVoucherInput = z.object({
  type: z.enum(VOUCHER_TYPES),
  contactId: z.string().uuid().optional(),
  voucherDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "voucherDate must be YYYY-MM-DD"),
  memo: z.string().max(1000).optional(),
  cashAccountId: z.string().uuid(),
  lines: z.array(zVoucherLineInput).min(1, "A voucher needs at least one line"),
});

export type VoucherInput = z.infer<typeof zVoucherInput>;

export function voucherTotal(lines: readonly { amountCents: Centavos }[]): Centavos {
  return sum(lines.map((l) => l.amountCents));
}

// ── Workflow (draft) vouchers — persisted lines, JE posted at approval ────────
export const zVoucherDraftLine = z.object({
  accountId: z.string().uuid(),
  description: z.string().max(500).optional(),
  amountCents: z.number().int().positive("Line amount must be greater than zero"),
  meta: z.record(z.unknown()).nullable().optional(),
});
export type VoucherDraftLine = z.infer<typeof zVoucherDraftLine>;

export const zVoucherDraftInput = z.object({
  type: z.enum(VOUCHER_TYPES),
  contactId: z.string().uuid().nullable().optional(),
  voucherDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "voucherDate must be YYYY-MM-DD"),
  memo: z.string().max(1000).optional(),
  notes: z.string().max(4000).nullable().optional(),
  purposeCategory: z.string().trim().max(160).nullable().optional(),
  // The cash/bank side of the eventual JE. Optional while drafting; required to approve.
  paymentFromAccountId: z.string().uuid().nullable().optional(),
  meta: z.record(z.unknown()).nullable().optional(),
  lines: z.array(zVoucherDraftLine).min(1, "A voucher needs at least one line"),
});
export type VoucherDraftInput = z.infer<typeof zVoucherDraftInput>;

/** Partial edit while draft/pending/rejected; `lines`, when given, replaces all. */
export const zVoucherUpdate = zVoucherDraftInput.partial();
export type VoucherUpdate = z.infer<typeof zVoucherUpdate>;

export const zVoucherStatusTransition = z.object({
  to: z.enum(VOUCHER_STATUSES),
});

/**
 * JE lines for an approved workflow voucher. Receipts credit the detail lines
 * and debit cash; every other type pays money out (debit detail, credit cash).
 */
export function buildDraftVoucherJournalLines(
  type: VoucherType,
  paymentFromAccountId: string,
  lines: readonly VoucherDraftLine[],
): JournalLineInput[] {
  const total = voucherTotal(lines);
  const isReceipt = type === "receipt";
  const detail: JournalLineInput[] = lines.map((l) => ({
    accountId: l.accountId,
    debitCents: isReceipt ? 0 : l.amountCents,
    creditCents: isReceipt ? l.amountCents : 0,
    ...(l.description ? { description: l.description } : {}),
  }));
  const cash: JournalLineInput = {
    accountId: paymentFromAccountId,
    debitCents: isReceipt ? total : 0,
    creditCents: isReceipt ? 0 : total,
  };
  return [...detail, cash];
}

/** Convert a voucher into balanced journal lines (cash side balances the detail). */
export function buildVoucherJournalLines(input: VoucherInput): JournalLineInput[] {
  const total = voucherTotal(input.lines);
  const isPayment = input.type === "payment";

  const detail: JournalLineInput[] = input.lines.map((l) => ({
    accountId: l.accountId,
    debitCents: isPayment ? l.amountCents : 0,
    creditCents: isPayment ? 0 : l.amountCents,
    ...(l.description ? { description: l.description } : {}),
  }));

  const cash: JournalLineInput = {
    accountId: input.cashAccountId,
    debitCents: isPayment ? 0 : total,
    creditCents: isPayment ? total : 0,
  };

  return [...detail, cash];
}
