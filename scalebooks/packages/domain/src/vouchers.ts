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

export const VOUCHER_TYPES = ["payment", "receipt"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

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
