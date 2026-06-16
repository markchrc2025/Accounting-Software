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
import { withOrgContext, journalEntries, journalLines, type Tx } from "@scalebooks/db";
import {
  zJournalEntryInput,
  assertBalanced,
  type JournalEntryInput,
} from "@scalebooks/domain";

export interface PostJournalEntryResult {
  id: string;
  entryNo: string;
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
  input: JournalEntryInput,
  ctx: { userId: string; orgId: string },
): Promise<PostJournalEntryResult> {
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

  await tx
    .update(journalEntries)
    .set({ status: "posted", postedAt: new Date() })
    .where(sql`${journalEntries.id} = ${entryId}`);

  return { id: entryId, entryNo };
}

export async function postJournalEntry(
  rawInput: unknown,
  ctx: { userId: string; orgId: string },
): Promise<PostJournalEntryResult> {
  // Validate shape + balance up front for a friendly 400 (the DB is the real guard).
  const input: JournalEntryInput = zJournalEntryInput.parse(rawInput);
  if (input.orgId !== ctx.orgId) {
    throw new Error("orgId mismatch between payload and authenticated caller");
  }
  assertBalanced(input.lines);

  return withOrgContext({ userId: ctx.userId, orgId: ctx.orgId }, (tx) =>
    postJournalEntryCore(tx, input, ctx),
  );
}

/**
 * Reverse a posted entry by inserting a NEW entry with debits/credits swapped.
 * The original is never mutated except its status flag (post -> reversed).
 */
export async function reverseJournalEntry(
  entryId: string,
  ctx: { userId: string; orgId: string },
): Promise<PostJournalEntryResult> {
  return withOrgContext({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const [original] = await tx
      .select()
      .from(journalEntries)
      .where(sql`${journalEntries.id} = ${entryId} AND ${journalEntries.orgId} = ${ctx.orgId}`);
    if (!original) throw new Error("Entry not found");
    if (original.status !== "posted") throw new Error("Only posted entries can be reversed");

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

    return { id: rev!.id, entryNo };
  });
}
