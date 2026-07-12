/**
 * Workflow vouchers: a voucher is an approvable DOCUMENT with its own persisted
 * lines. Nothing touches the ledger until approval, when a balanced journal
 * entry is posted from those lines (source_type='voucher'); voiding an approved
 * voucher reverses that entry in the same transaction.
 *
 * The legacy atomic path (createVoucher: create + post in one call, used by the
 * simple app) is untouched — this file is the portal's document workflow.
 */
import { sql, and, asc, eq } from "drizzle-orm";
import { withOrgContext, vouchers, voucherLines, type Tx } from "@sentire-books/db";
import {
  zVoucherDraftInput,
  voucherTotal,
  buildDraftVoucherJournalLines,
  VOUCHER_PREFIX,
  type VoucherDraftInput,
  type VoucherType,
} from "@sentire-books/domain";
import { postJournalEntryCore, reverseJournalEntryCore } from "./postJournalEntry";

export class VoucherNotFoundError extends Error {
  constructor() {
    super("Voucher not found");
  }
}
export class MissingCashAccountError extends Error {
  constructor() {
    super("Set the payment-from (cash/bank) account before approving");
  }
}

async function nextVoucherNo(tx: Tx, orgId: string, type: VoucherType, isoDate: string): Promise<string> {
  const periodKey = `${VOUCHER_PREFIX[type]}${isoDate.slice(0, 4)}${isoDate.slice(5, 7)}`;
  const counter = (await tx.execute(sql`
    INSERT INTO document_counters (org_id, period_key, seq)
    VALUES (${orgId}, ${periodKey}, 1)
    ON CONFLICT (org_id, period_key)
    DO UPDATE SET seq = document_counters.seq + 1
    RETURNING seq
  `)) as unknown as Array<{ seq: number }>;
  return `${periodKey}-${String(counter[0]!.seq).padStart(4, "0")}`;
}

export interface VoucherDraftResult {
  id: string;
  voucherNo: string;
  status: string;
}

/** Create a workflow voucher (status 'draft', lines persisted, no JE). */
export async function createVoucherDraft(
  rawInput: unknown,
  ctx: { userId: string; orgId: string },
): Promise<VoucherDraftResult> {
  const input: VoucherDraftInput = zVoucherDraftInput.parse(rawInput);
  return withOrgContext({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const voucherNo = await nextVoucherNo(tx, ctx.orgId, input.type, input.voucherDate);
    const [voucher] = await tx
      .insert(vouchers)
      .values({
        orgId: ctx.orgId,
        voucherNo,
        voucherType: input.type,
        contactId: input.contactId ?? null,
        voucherDate: input.voucherDate,
        memo: input.memo ?? null,
        notes: input.notes ?? null,
        purposeCategory: input.purposeCategory ?? null,
        paymentFromAccountId: input.paymentFromAccountId ?? null,
        meta: input.meta ?? null,
        status: "draft",
        totalCents: voucherTotal(input.lines),
        createdBy: ctx.userId,
      })
      .returning({ id: vouchers.id });
    await tx.insert(voucherLines).values(
      input.lines.map((l, i) => ({
        voucherId: voucher!.id,
        lineNo: i + 1,
        accountId: l.accountId,
        description: l.description ?? null,
        amountCents: l.amountCents,
        meta: l.meta ?? null,
      })),
    );
    return { id: voucher!.id, voucherNo, status: "draft" };
  });
}

/** Post the JE for a voucher reaching 'approved' (runs inside the transition tx). */
export async function approveVoucherCore(
  tx: Tx,
  voucherId: string,
  ctx: { userId: string; orgId: string },
): Promise<{ journalEntryId: string; entryNo: string }> {
  const [voucher] = await tx
    .select()
    .from(vouchers)
    .where(and(eq(vouchers.id, voucherId), eq(vouchers.orgId, ctx.orgId)));
  if (!voucher) throw new VoucherNotFoundError();
  if (!voucher.paymentFromAccountId) throw new MissingCashAccountError();

  const lines = await tx
    .select()
    .from(voucherLines)
    .where(eq(voucherLines.voucherId, voucherId))
    .orderBy(asc(voucherLines.lineNo));

  const jeLines = buildDraftVoucherJournalLines(
    voucher.voucherType,
    voucher.paymentFromAccountId,
    lines.map((l) => ({
      accountId: l.accountId,
      amountCents: l.amountCents,
      ...(l.description ? { description: l.description } : {}),
    })),
  );
  const je = await postJournalEntryCore(
    tx,
    {
      orgId: ctx.orgId,
      entryDate: voucher.voucherDate,
      memo: voucher.memo ?? `${VOUCHER_PREFIX[voucher.voucherType]} ${voucher.voucherNo}`,
      sourceType: "voucher",
      sourceId: voucherId,
      lines: jeLines,
    },
    ctx,
  );
  await tx
    .update(vouchers)
    .set({ journalEntryId: je.id, postedAt: new Date() })
    .where(eq(vouchers.id, voucherId));
  return { journalEntryId: je.id, entryNo: je.entryNo };
}

/** Void a voucher; if its JE was posted, reverse it in the same transaction. */
export async function voidVoucher(
  voucherId: string,
  ctx: { userId: string; orgId: string },
): Promise<{ id: string; status: string; reversalEntryNo?: string }> {
  return withOrgContext({ userId: ctx.userId, orgId: ctx.orgId }, async (tx) => {
    const [voucher] = await tx
      .select()
      .from(vouchers)
      .where(and(eq(vouchers.id, voucherId), eq(vouchers.orgId, ctx.orgId)));
    if (!voucher) throw new VoucherNotFoundError();

    let reversalEntryNo: string | undefined;
    if (voucher.journalEntryId) {
      const rev = await reverseJournalEntryCore(tx, voucher.journalEntryId, ctx);
      reversalEntryNo = rev.entryNo;
    }
    await tx.update(vouchers).set({ status: "void" }).where(eq(vouchers.id, voucherId));
    return reversalEntryNo !== undefined
      ? { id: voucherId, status: "void", reversalEntryNo }
      : { id: voucherId, status: "void" };
  });
}
