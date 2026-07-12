import { Hono } from "hono";
import { ZodError } from "zod";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  zDisbursementReportInput,
  zDisbursementReportUpdate,
  zDisbursementStatusUpdate,
  type DisbursementReportUpdate,
} from "@scalebooks/domain";
import { withOrgContext, disbursementReports, vouchers, type Tx } from "@scalebooks/db";
import { requireAuth } from "../auth";

export const disbursementRoutes = new Hono();
disbursementRoutes.use("*", requireAuth);

const lineVoucherIds = (lines: unknown): string[] => {
  if (!Array.isArray(lines)) return [];
  return [
    ...new Set(
      lines
        .map((l) => (l && typeof l === "object" ? (l as { voucherId?: string }).voucherId : undefined))
        .filter((v): v is string => typeof v === "string" && v.length === 36),
    ),
  ];
};

async function nextReportNo(tx: Tx, orgId: string, isoDate: string): Promise<string> {
  const periodKey = `DR${isoDate.slice(0, 4)}${isoDate.slice(5, 7)}`;
  const counter = (await tx.execute(sql`
    INSERT INTO document_counters (org_id, period_key, seq)
    VALUES (${orgId}, ${periodKey}, 1)
    ON CONFLICT (org_id, period_key)
    DO UPDATE SET seq = document_counters.seq + 1
    RETURNING seq
  `)) as unknown as Array<{ seq: number }>;
  return `${periodKey}-${String(counter[0]!.seq).padStart(4, "0")}`;
}

/** Park vouchers in this report: remember where they came from, flip status.
 * (Postgres evaluates SET expressions on the OLD row, so the status snapshot
 * and the flip can happen in one UPDATE.) */
async function claimVouchers(tx: Tx, orgId: string, ids: string[], reportNo: string) {
  if (!ids.length) return;
  await tx
    .update(vouchers)
    .set({
      preDisbursementStatus: sql`status::text`,
      status: "for_disbursement",
      disbursementRef: reportNo,
    })
    .where(
      and(eq(vouchers.orgId, orgId), inArray(vouchers.id, ids), ne(vouchers.status, "for_disbursement")),
    );
}

/** Return vouchers to the status they held before entering the report. */
async function revertVouchers(tx: Tx, orgId: string, ids: string[]) {
  if (!ids.length) return;
  await tx
    .update(vouchers)
    .set({
      status: sql`COALESCE(NULLIF(pre_disbursement_status, ''), 'approved')::voucher_status`,
      preDisbursementStatus: null,
      disbursementRef: null,
    })
    .where(
      and(eq(vouchers.orgId, orgId), inArray(vouchers.id, ids), eq(vouchers.status, "for_disbursement")),
    );
}

/** Approved disbursement: queued vouchers are paid. */
async function payVouchers(tx: Tx, orgId: string, ids: string[]) {
  if (!ids.length) return;
  await tx
    .update(vouchers)
    .set({ status: "paid", preDisbursementStatus: null, disbursementRef: null })
    .where(and(eq(vouchers.orgId, orgId), inArray(vouchers.id, ids)));
}

function reportColumns(input: DisbursementReportUpdate) {
  const set: Record<string, unknown> = {};
  if (input.reportDate !== undefined) set.reportDate = input.reportDate;
  if (input.bankCode !== undefined) set.bankCode = input.bankCode;
  if (input.totalCents !== undefined) set.totalCents = input.totalCents;
  if (input.expectedCollectionCents !== undefined) set.expectedCollectionCents = input.expectedCollectionCents;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.bankBalances !== undefined) set.bankBalances = input.bankBalances;
  if (input.lines !== undefined) set.lines = input.lines;
  if (input.meta !== undefined) set.meta = input.meta;
  return set;
}

disbursementRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const rows = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select()
        .from(disbursementReports)
        .where(eq(disbursementReports.orgId, auth.orgId))
        .orderBy(desc(disbursementReports.reportDate), desc(disbursementReports.createdAt))
        .limit(500),
  );
  return c.json({ reports: rows });
});

disbursementRoutes.get("/:id", async (c) => {
  const auth = c.get("auth");
  const [row] = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select()
        .from(disbursementReports)
        .where(and(eq(disbursementReports.orgId, auth.orgId), eq(disbursementReports.id, c.req.param("id")))),
  );
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ report: row });
});

// Create: assigns DR{YYYYMM}-#### and parks every referenced voucher.
disbursementRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const input = zDisbursementReportInput.parse(body);
    const row = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const reportNo = await nextReportNo(tx, auth.orgId, input.reportDate);
        const [report] = await tx
          .insert(disbursementReports)
          .values({
            orgId: auth.orgId,
            reportNo,
            reportDate: input.reportDate,
            bankCode: input.bankCode ?? "MULTIPLE",
            totalCents: input.totalCents,
            expectedCollectionCents: input.expectedCollectionCents,
            notes: input.notes ?? null,
            bankBalances: input.bankBalances ?? null,
            lines: input.lines,
            meta: input.meta ?? null,
            createdBy: auth.userId,
          })
          .returning();
        await claimVouchers(tx, auth.orgId, lineVoucherIds(input.lines), reportNo);
        return report;
      },
    );
    return c.json({ report: row }, 201);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[createDisbursement]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Update: diffs the voucher set — newly added are parked, removed are reverted.
disbursementRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const input = zDisbursementReportUpdate.parse(body);
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(disbursementReports)
          .where(and(eq(disbursementReports.orgId, auth.orgId), eq(disbursementReports.id, id)));
        if (!existing) return null;
        if (input.lines !== undefined) {
          const prev = lineVoucherIds(existing.lines);
          const next = lineVoucherIds(input.lines);
          await claimVouchers(tx, auth.orgId, next.filter((v) => !prev.includes(v)), existing.reportNo);
          await revertVouchers(tx, auth.orgId, prev.filter((v) => !next.includes(v)));
        }
        const set = reportColumns(input);
        if (Object.keys(set).length === 0) return existing;
        const [row] = await tx
          .update(disbursementReports)
          .set(set)
          .where(eq(disbursementReports.id, id))
          .returning();
        return row;
      },
    );
    if (!outcome) return c.json({ error: "not_found" }, 404);
    return c.json({ report: outcome });
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[updateDisbursement]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Status: Approved pays every queued voucher; Rejected reverts them. Reviewer/
// approver stamps and the reject reason are kept in meta.
disbursementRoutes.post("/:id/status", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const { status, reason } = zDisbursementStatusUpdate.parse(body);
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(disbursementReports)
          .where(and(eq(disbursementReports.orgId, auth.orgId), eq(disbursementReports.id, id)));
        if (!existing) return null;
        const ids = lineVoucherIds(existing.lines);
        if (status === "Approved") await payVouchers(tx, auth.orgId, ids);
        if (status === "Rejected") await revertVouchers(tx, auth.orgId, ids);
        const meta = {
          ...((existing.meta as Record<string, unknown>) ?? {}),
          ...(reason ? { rejectReason: reason } : { rejectReason: "" }),
          ...(status === "For Approval" ? { reviewedBy: auth.email } : {}),
          ...(status === "Approved" ? { approvedBy: auth.email } : {}),
        };
        const [row] = await tx
          .update(disbursementReports)
          .set({ status, meta })
          .where(eq(disbursementReports.id, id))
          .returning();
        return row;
      },
    );
    if (!outcome) return c.json({ error: "not_found" }, 404);
    return c.json({ report: outcome });
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[disbursementStatus]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Delete: reverts every queued voucher, then removes the report.
disbursementRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const outcome = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    async (tx) => {
      const [existing] = await tx
        .select()
        .from(disbursementReports)
        .where(and(eq(disbursementReports.orgId, auth.orgId), eq(disbursementReports.id, id)));
      if (!existing) return null;
      await revertVouchers(tx, auth.orgId, lineVoucherIds(existing.lines));
      await tx.delete(disbursementReports).where(eq(disbursementReports.id, id));
      return true;
    },
  );
  if (!outcome) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
