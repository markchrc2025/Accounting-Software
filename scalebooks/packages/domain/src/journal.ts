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

export const ENTRY_STATUSES = [
  "draft",
  "pending_review",
  "pending_approval",
  "for_clearing",
  "cleared",
  "for_posting",
  "posted",
  "rejected",
  "voided",
  "reversed",
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const ENTRY_TYPES = ["Manual", "Adjusting", "Accrual", "Closing", "Reversing"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/**
 * Maker-checker workflow: which statuses may move where. Posting itself
 * ('for_posting' → 'posted') is the only transition that touches the ledger —
 * the DB's deferred balance trigger validates it at commit, and once posted the
 * entry is append-only (reversal is a separate, offsetting entry).
 */
export const JOURNAL_TRANSITIONS: Readonly<Record<string, readonly EntryStatus[]>> = {
  draft: ["pending_review"],
  pending_review: ["pending_approval", "for_clearing", "rejected", "draft"],
  pending_approval: ["for_clearing", "rejected", "draft"],
  for_clearing: ["cleared", "rejected"],
  cleared: ["for_posting", "rejected"],
  for_posting: ["posted", "rejected"],
  rejected: ["draft"],
};

/** Statuses whose header/lines may still be edited (pre-ledger). */
export const EDITABLE_STATUSES: readonly EntryStatus[] = [
  "draft",
  "pending_review",
  "pending_approval",
  "for_clearing",
  "cleared",
  "for_posting",
  "rejected",
];

/** Statuses a whole entry may be deleted in (never reached the ledger). */
export const DELETABLE_STATUSES: readonly EntryStatus[] = ["draft", "rejected"];

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
    entryType: z.enum(ENTRY_TYPES).default("Manual"),
    reference: z.string().trim().max(200).optional(),
    // post=true (default) writes straight to the ledger; post=false saves a
    // workflow draft that must travel the maker-checker transitions to post.
    post: z.boolean().default(true),
    sourceType: z.string().max(64).optional(),
    sourceId: z.string().uuid().optional(),
    lines: z.array(zJournalLineInput).min(2, "A journal entry needs at least two lines"),
  })
  // Balance is required to POST; a draft may be work-in-progress (the DB's
  // deferred trigger enforces balance again at the posting transition).
  .refine((e) => !e.post || isBalanced(e.lines), {
    message: "Debits must equal credits",
    path: ["lines"],
  });

export type JournalEntryInput = z.infer<typeof zJournalEntryInput>;

/** Partial edit of a not-yet-posted entry; `lines`, when given, replaces all lines. */
export const zJournalEntryUpdate = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "entryDate must be YYYY-MM-DD").optional(),
  memo: z.string().max(1000).nullable().optional(),
  entryType: z.enum(ENTRY_TYPES).optional(),
  reference: z.string().trim().max(200).nullable().optional(),
  lines: z.array(zJournalLineInput).min(2).optional(),
});

export type JournalEntryUpdate = z.infer<typeof zJournalEntryUpdate>;

export const zJournalStatusTransition = z.object({
  to: z.enum(ENTRY_STATUSES),
});

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
