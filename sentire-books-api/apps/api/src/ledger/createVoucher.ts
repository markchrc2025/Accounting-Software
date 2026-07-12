/**
 * Create a voucher and post its journal entry ATOMICALLY (one transaction).
 *
 * Order matters: the voucher row is inserted first (so its id can be stamped on
 * the JE's source_id), then the JE is posted, then the voucher is finalized with
 * the JE id. If anything fails — including the deferred balance trigger at COMMIT —
 * the whole transaction rolls back, so there is never an orphaned voucher or a JE
 * without its source. This is the bug the legacy Firestore flow could not avoid.
 */
import { eq, sql } from "drizzle-orm";
import { withOrgContext, vouchers } from "@sentire-books/db";
import {
  zVoucherInput,
  buildVoucherJournalLines,
  voucherTotal,
  assertBalanced,
} from "@sentire-books/domain";
import { postJournalEntryCore } from "./postJournalEntry";

export interface CreateVoucherResult {
  id: string;
  voucherNo: string;
  journalEntryId: string;
  entryNo: string;
}

export async function createVoucher(
  rawInput: unknown,
  ctx: { userId: string; orgId: string },
): Promise<CreateVoucherResult> {
  const input = zVoucherInput.parse(rawInput);
  const jeLines = buildVoucherJournalLines(input);
  assertBalanced(jeLines); // sanity — the DB trigger is the real guard
  const total = voucherTotal(input.lines);

  const prefix = input.type === "payment" ? "PV" : "RV";
  const periodKey = `${prefix}${input.voucherDate.slice(0, 4)}${input.voucherDate.slice(5, 7)}`;

  return withOrgContext({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    // 1 — atomic voucher number
    const counter = (await tx.execute(sql`
      INSERT INTO document_counters (org_id, period_key, seq)
      VALUES (${ctx.orgId}, ${periodKey}, 1)
      ON CONFLICT (org_id, period_key)
      DO UPDATE SET seq = document_counters.seq + 1
      RETURNING seq
    `)) as unknown as Array<{ seq: number }>;
    const voucherNo = `${periodKey}-${String(counter[0]!.seq).padStart(4, "0")}`;

    // 2 — voucher row first (draft), to get its id for the JE source_id
    const [voucher] = await tx
      .insert(vouchers)
      .values({
        orgId: ctx.orgId,
        voucherNo,
        voucherType: input.type,
        contactId: input.contactId ?? null,
        voucherDate: input.voucherDate,
        memo: input.memo ?? null,
        status: "draft",
        totalCents: total,
        createdBy: ctx.userId,
      })
      .returning({ id: vouchers.id });
    const voucherId = voucher!.id;

    // 3 — post the JE within the same transaction, linked back to the voucher
    const je = await postJournalEntryCore(
      tx,
      {
        orgId: ctx.orgId,
        entryDate: input.voucherDate,
        memo: input.memo ?? `${prefix} ${voucherNo}`,
        sourceType: "voucher",
        sourceId: voucherId,
        lines: jeLines,
      },
      ctx,
    );

    // 4 — finalize the voucher (mutable: vouchers have no append-only trigger)
    await tx
      .update(vouchers)
      .set({ status: "posted", journalEntryId: je.id, postedAt: new Date() })
      .where(eq(vouchers.id, voucherId));

    return { id: voucherId, voucherNo, journalEntryId: je.id, entryNo: je.entryNo };
  });
}
