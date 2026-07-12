/**
 * The ONE place journal entries are posted. Everything else (vouchers, checks,
 * payments) ultimately calls this. It runs entirely inside a single DB
 * transaction, so it is all-or-nothing — the partial-write bugs from the old
 * Firestore code (orphaned vouchers, JE without source, etc.) are impossible here.
 *
 * Flow:
 *   1. allocate entry_no atomically (counter upsert — no number races)
 *   2. insert the entry as 'draft'
 *   3. insert all lines
 *   4. flip the entry to 'posted'
 *   5. COMMIT → the deferred balance trigger verifies Σdebit = Σcredit
 */
import { sql } from "drizzle-orm";
import { withOrgContext, journalEntries, journalLines, type Tx } from "@sentire-books/db";
import {
  zJournalEntryInput,
  assertBalanced,
  type JournalEntryInput,
  type JournalLineInput,
  type EntryType,
} from "@sentire-books/domain";

export interface PostJournalEntryResult {
  id: string;
  entryNo: string;
  status: string;
  /** Present when an Accrual entry auto-created its future-dated reversing draft. */
  accrualReversal?: { id: string; entryNo: string; entryDate: string };
}

/**
 * Structural input for the shared core: `post`/`entryType` are optional so
 * internal callers (createVoucher) keep passing plain literals; the public
 * route path parses the full zod schema first.
 */
export interface CoreEntryInput {
  orgId: string;
  entryDate: string;
  memo?: string | null | undefined;
  entryType?: EntryType | undefined;
  reference?: string | null | undefined;
  post?: boolean | undefined;
  sourceType?: string | null | undefined;
  sourceId?: string | null | undefined;
  accrualReversalOf?: string | null | undefined;
  lines: readonly JournalLineInput[];
}

/** Reversal target doesn't exist in the caller's org → HTTP 404. */
export class EntryNotFoundError extends Error {
  constructor() {
    super("Entry not found");
  }
}

/** Reversal target isn't in 'posted' status → HTTP 409. */
export class EntryNotPostedError extends Error {
  constructor() {
    super("Only posted entries can be reversed");
  }
}

function periodKey(prefix: string, isoDate: string): string {
  const [y, m] = isoDate.split("-");
  return `${prefix}${y}${m}`; // e.g. JE202606
}

/**
 * Post a (pre-validated) entry inside an EXISTING transaction. This is the
 * shared core so callers like createVoucher can post a JE atomically alongside
 * their own writes. Allocates the number, inserts the entry + lines, posts it;
 * the deferred balance trigger fires at the enclosing COMMIT.
 */
export async function postJournalEntryCore(
  tx: Tx,
  input: CoreEntryInput,
  ctx: { userId: string; orgId: string },
): Promise<PostJournalEntryResult> {
  const post = input.post !== false;
  const key = periodKey("JE", input.entryDate);
  const counter = (await tx.execute(sql`
    INSERT INTO document_counters (org_id, period_key, seq)
    VALUES (${ctx.orgId}, ${key}, 1)
    ON CONFLICT (org_id, period_key)
    DO UPDATE SET seq = document_counters.seq + 1
    RETURNING seq
  `)) as unknown as Array<{ seq: number }>;
  const seq = counter[0]!.seq;
  const entryNo = `${key}-${String(seq).padStart(4, "0")}`;

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      orgId: ctx.orgId,
      entryNo,
      entryDate: input.entryDate,
      memo: input.memo ?? null,
      status: "draft",
      entryType: input.entryType ?? "Manual",
      reference: input.reference ?? null,
      accrualReversalOf: input.accrualReversalOf ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      createdBy: ctx.userId,
    })
    .returning({ id: journalEntries.id });

  const entryId = entry!.id;

  await tx.insert(journalLines).values(
    input.lines.map((l, i) => ({
      entryId,
      lineNo: i + 1,
      accountId: l.accountId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      contactId: l.contactId ?? null,
      description: l.description ?? null,
    })),
  );

  if (post) {
    await tx
      .update(journalEntries)
      .set({ status: "posted", postedAt: new Date() })
      .where(sql`${journalEntries.id} = ${entryId}`);
  }

  return { id: entryId, entryNo, status: post ? "posted" : "draft" };
}

/** First day of the month after an ISO date — the accrual auto-reversal date. */
export function firstOfNextMonth(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const year = m === 12 ? y! + 1 : y!;
  const month = m === 12 ? 1 : m! + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export async function postJournalEntry(
  rawInput: unknown,
  ctx: { userId: string; orgId: string },
): Promise<PostJournalEntryResult> {
  // Validate shape up front for a friendly 400 (the DB is the real guard).
  const input: JournalEntryInput = zJournalEntryInput.parse(rawInput);
  if (input.orgId !== ctx.orgId) {
    throw new Error("orgId mismatch between payload and authenticated caller");
  }
  if (input.post) assertBalanced(input.lines);

  return withOrgContext({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const result = await postJournalEntryCore(tx, input, ctx);

    // Accrual entries auto-create their reversing DRAFT, dated the 1st of the
    // following month with debits/credits swapped, linked back to the original.
    if (input.entryType === "Accrual") {
      const reversalDate = firstOfNextMonth(input.entryDate);
      const rev = await postJournalEntryCore(
        tx,
        {
          orgId: ctx.orgId,
          entryDate: reversalDate,
          memo: `Accrual Reversal of ${result.entryNo}`,
          entryType: "Reversing",
          reference: result.entryNo,
          accrualReversalOf: result.id,
          post: false,
          lines: input.lines.map((l) => ({
            ...l,
            debitCents: l.creditCents,
            creditCents: l.debitCents,
          })),
        },
        ctx,
      );
      result.accrualReversal = { id: rev.id, entryNo: rev.entryNo, entryDate: reversalDate };
    }
    return result;
  });
}

/**
 * Reverse a posted entry by inserting a NEW entry with debits/credits swapped.
 * The original is never mutated except its status flag (post -> reversed).
 */
export async function reverseJournalEntry(
  entryId: string,
  ctx: { userId: string; orgId: string },
): Promise<PostJournalEntryResult> {
  return withOrgContext({ userId: ctx.userId, orgId: ctx.orgId }, (tx) =>
    reverseJournalEntryCore(tx, entryId, ctx),
  );
}

/** Reverse inside an EXISTING transaction (e.g. voiding a voucher atomically). */
export async function reverseJournalEntryCore(
  tx: Tx,
  entryId: string,
  ctx: { userId: string; orgId: string },
): Promise<PostJournalEntryResult> {
  {
    const [original] = await tx
      .select()
      .from(journalEntries)
      .where(sql`${journalEntries.id} = ${entryId} AND ${journalEntries.orgId} = ${ctx.orgId}`);
    if (!original) throw new EntryNotFoundError();
    if (original.status !== "posted") throw new EntryNotPostedError();

    const lines = await tx
      .select()
      .from(journalLines)
      .where(sql`${journalLines.entryId} = ${entryId}`);

    const key = periodKey("JE", original.entryDate);
    const counter = (await tx.execute(sql`
      INSERT INTO document_counters (org_id, period_key, seq)
      VALUES (${ctx.orgId}, ${key}, 1)
      ON CONFLICT (org_id, period_key)
      DO UPDATE SET seq = document_counters.seq + 1
      RETURNING seq
    `)) as unknown as Array<{ seq: number }>;
    const entryNo = `${key}-${String(counter[0]!.seq).padStart(4, "0")}`;

    const [rev] = await tx
      .insert(journalEntries)
      .values({
        orgId: ctx.orgId,
        entryNo,
        entryDate: original.entryDate,
        memo: `Reversal of ${original.entryNo}`,
        status: "draft",
        entryType: "Reversing",
        reference: original.entryNo,
        reversalOf: original.id,
        createdBy: ctx.userId,
      })
      .returning({ id: journalEntries.id });

    await tx.insert(journalLines).values(
      lines.map((l, i) => ({
        entryId: rev!.id,
        lineNo: i + 1,
        accountId: l.accountId,
        debitCents: l.creditCents, // swapped
        creditCents: l.debitCents, // swapped
        contactId: l.contactId,
        description: l.description,
      })),
    );

    await tx
      .update(journalEntries)
      .set({ status: "posted", postedAt: new Date() })
      .where(sql`${journalEntries.id} = ${rev!.id}`);

    // mark the original reversed (the only mutation the trigger allows)
    await tx
      .update(journalEntries)
      .set({ status: "reversed" })
      .where(sql`${journalEntries.id} = ${original.id}`);

    return { id: rev!.id, entryNo, status: "posted" };
  }
}
