/**
 * Journal-entry domain model + validation, shared by the API and the web app.
 *
 * The double-entry invariant (Σ debits = Σ credits) is validated here for a
 * friendly client-side error, AND enforced at the database level by a deferred
 * constraint trigger (see packages/db). The DB is the source of truth — the app
 * checks are advisory UX, never the only guard.
 */
import { z } from "zod";
import { sum, type Centavos } from "./money";

export const ENTRY_STATUSES = ["draft", "posted", "reversed"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** A non-negative integer count of centavos. */
const zCentavos = z
  .number()
  .int("Amount must be a whole number of centavos")
  .nonnegative("Amount cannot be negative")
  .finite();

export const zJournalLineInput = z
  .object({
    accountId: z.string().uuid(),
    debitCents: zCentavos.default(0),
    creditCents: zCentavos.default(0),
    contactId: z.string().uuid().optional(),
    description: z.string().max(500).optional(),
  })
  .refine((l) => l.debitCents === 0 || l.creditCents === 0, {
    message: "A line cannot have both a debit and a credit",
  })
  .refine((l) => l.debitCents > 0 || l.creditCents > 0, {
    message: "A line must have a non-zero debit or credit",
  });

export type JournalLineInput = z.infer<typeof zJournalLineInput>;

export const zJournalEntryInput = z
  .object({
    orgId: z.string().uuid(),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD"),
    memo: z.string().max(1000).optional(),
    sourceType: z.string().max(64).optional(),
    sourceId: z.string().uuid().optional(),
    lines: z.array(zJournalLineInput).min(2, "A journal entry needs at least two lines"),
  })
  .refine((e) => isBalanced(e.lines), {
    message: "Debits must equal credits",
    path: ["lines"],
  });

export type JournalEntryInput = z.infer<typeof zJournalEntryInput>;

export function totalDebits(lines: readonly { debitCents: Centavos }[]): Centavos {
  return sum(lines.map((l) => l.debitCents));
}

export function totalCredits(lines: readonly { creditCents: Centavos }[]): Centavos {
  return sum(lines.map((l) => l.creditCents));
}

export function isBalanced(
  lines: readonly { debitCents: Centavos; creditCents: Centavos }[],
): boolean {
  const debit = totalDebits(lines);
  const credit = totalCredits(lines);
  // Integer comparison — no tolerance needed (unlike the old `< 0.005` float hack).
  return debit === credit && debit > 0;
}

export class UnbalancedEntryError extends Error {
  constructor(
    public readonly debit: Centavos,
    public readonly credit: Centavos,
  ) {
    super(`Journal entry is out of balance: debit=${debit} credit=${credit}`);
  }
}

export function assertBalanced(
  lines: readonly { debitCents: Centavos; creditCents: Centavos }[],
): void {
  if (!isBalanced(lines)) {
    throw new UnbalancedEntryError(totalDebits(lines), totalCredits(lines));
  }
}
