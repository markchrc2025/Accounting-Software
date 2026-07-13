import { Hono } from "hono";
import { ZodError } from "zod";
import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import {
  zCheckbookInput,
  zCheckbookUpdate,
  zCheckInput,
  zCheckUpdate,
  zCheckStatusUpdate,
  CHECK_STATUSES,
  type CheckUpdate,
} from "@sentire-books/domain";
import { withOrgContext, checkbooks, checkRegistry, type Tx } from "@sentire-books/db";
import { requireAuth } from "../auth";

// ── Checkbook master ──────────────────────────────────────────────────────────
export const checkbookRoutes = new Hono();
checkbookRoutes.use("*", requireAuth);

checkbookRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const rows = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select()
        .from(checkbooks)
        .where(eq(checkbooks.orgId, auth.orgId))
        .orderBy(asc(checkbooks.bankCode), desc(checkbooks.createdAt)),
  );
  return c.json({ checkbooks: rows });
});

checkbookRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const input = zCheckbookInput.parse(body);
    const [row] = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        // One active book per bank: activating this one deactivates the others.
        if (input.isActive) {
          await tx
            .update(checkbooks)
            .set({ isActive: false })
            .where(and(eq(checkbooks.orgId, auth.orgId), eq(checkbooks.bankCode, input.bankCode)));
        }
        return tx
          .insert(checkbooks)
          .values({
            orgId: auth.orgId,
            bankCode: input.bankCode,
            checkbookType: input.checkbookType ?? "Loose",
            startingNumber: input.startingNumber,
            endingNumber: input.endingNumber ?? null,
            checksCount: input.checksCount ?? null,
            nextCheckNumber: input.nextCheckNumber ?? input.startingNumber,
            isActive: input.isActive,
            notes: input.notes ?? null,
            createdBy: auth.userId,
          })
          .returning();
      },
    );
    return c.json({ checkbook: row }, 201);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[createCheckbook]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

checkbookRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const input = zCheckbookUpdate.parse(body);
    const set: Record<string, unknown> = {};
    for (const k of [
      "bankCode",
      "checkbookType",
      "startingNumber",
      "endingNumber",
      "checksCount",
      "nextCheckNumber",
      "isActive",
      "notes",
    ] as const) {
      if (input[k] !== undefined) set[k] = input[k];
    }
    if (Object.keys(set).length === 0) return c.json({ error: "no_fields" }, 400);

    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [existing] = await tx
          .select()
          .from(checkbooks)
          .where(and(eq(checkbooks.orgId, auth.orgId), eq(checkbooks.id, id)));
        if (!existing) return null;
        const bank = (set.bankCode as string) ?? existing.bankCode;
        if (set.isActive === true) {
          await tx
            .update(checkbooks)
            .set({ isActive: false })
            .where(and(eq(checkbooks.orgId, auth.orgId), eq(checkbooks.bankCode, bank), ne(checkbooks.id, id)));
        }
        const [row] = await tx.update(checkbooks).set(set).where(eq(checkbooks.id, id)).returning();
        return row;
      },
    );
    if (!outcome) return c.json({ error: "not_found" }, 404);
    return c.json({ checkbook: outcome });
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[updateCheckbook]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

checkbookRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  try {
    const [row] = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) =>
        tx
          .delete(checkbooks)
          .where(and(eq(checkbooks.orgId, auth.orgId), eq(checkbooks.id, id)))
          .returning({ id: checkbooks.id }),
    );
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23503") {
      return c.json({ error: "checkbook_in_use", detail: "Checks reference this checkbook." }, 409);
    }
    console.error("[deleteCheckbook]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// ── Check registry ────────────────────────────────────────────────────────────
export const checkRoutes = new Hono();
checkRoutes.use("*", requireAuth);

export async function nextCheckNo(tx: Tx, orgId: string): Promise<string> {
  const now = new Date();
  const periodKey = `CHKR${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const counter = (await tx.execute(sql`
    INSERT INTO document_counters (org_id, period_key, seq)
    VALUES (${orgId}, ${periodKey}, 1)
    ON CONFLICT (org_id, period_key)
    DO UPDATE SET seq = document_counters.seq + 1
    RETURNING seq
  `)) as unknown as Array<{ seq: number }>;
  return `${periodKey.replace("CHKR", "CHK")}-${String(counter[0]!.seq).padStart(4, "0")}`;
}

function checkColumns(input: CheckUpdate) {
  const set: Record<string, unknown> = {};
  for (const k of [
    "checkbookId",
    "bankCode",
    "checkNumber",
    "checkDate",
    "issueDate",
    "payeeName",
    "amountCents",
    "netAmountCents",
    "referenceType",
    "referenceId",
    "voucherId",
    "journalEntryId",
    "isPartOfMultiple",
    "lineNo",
    "notes",
    "meta",
  ] as const) {
    if (input[k] !== undefined) set[k] = input[k];
  }
  return set;
}

// List: ?status=&bankCode=&q=&limit=&offset=
checkRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 500, 1), 1000);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const where = [eq(checkRegistry.orgId, auth.orgId)];
  if (q.status && (CHECK_STATUSES as readonly string[]).includes(q.status)) {
    where.push(eq(checkRegistry.status, q.status));
  }
  if (q.bankCode) where.push(eq(checkRegistry.bankCode, q.bankCode));
  if (q.q) {
    const needle = `%${q.q}%`;
    where.push(
      or(
        ilike(checkRegistry.checkNo, needle),
        ilike(checkRegistry.checkNumber, needle),
        ilike(checkRegistry.payeeName, needle),
        ilike(checkRegistry.referenceId, needle),
      )!,
    );
  }
  const rows = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select()
        .from(checkRegistry)
        .where(and(...where))
        .orderBy(desc(checkRegistry.issueDate), desc(checkRegistry.createdAt))
        .limit(limit)
        .offset(offset),
  );
  return c.json({ checks: rows });
});

// Create one check or a batch ({ checks: [...] }) — e.g. a multi-check voucher.
checkRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const batch = Array.isArray((body as { checks?: unknown[] })?.checks)
      ? (body as { checks: unknown[] }).checks
      : [body];
    const inputs = batch.map((b) => zCheckInput.parse(b));
    const rows = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const created = [];
        for (const input of inputs) {
          const checkNo = input.checkNo || (await nextCheckNo(tx, auth.orgId));
          const [row] = await tx
            .insert(checkRegistry)
            .values({
              orgId: auth.orgId,
              checkNo,
              checkNumber: input.checkNumber,
              amountCents: input.amountCents,
              ...checkColumns(input),
              createdBy: auth.userId,
            })
            .returning();
          created.push(row);
        }
        return created;
      },
    );
    return c.json({ checks: rows }, 201);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[createChecks]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

checkRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const input = zCheckUpdate.parse(body);
    const set = checkColumns(input);
    if (Object.keys(set).length === 0) return c.json({ error: "no_fields" }, 400);
    const [row] = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) =>
        tx
          .update(checkRegistry)
          .set(set)
          .where(and(eq(checkRegistry.orgId, auth.orgId), eq(checkRegistry.id, id)))
          .returning(),
    );
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ check: row });
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[updateCheck]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Lifecycle: Issued → Cleared / Voided / Stopped / Stale. Stamps the matching
// date column; void/stop record the reason.
checkRoutes.post("/:id/status", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const { status, date, reason } = zCheckStatusUpdate.parse(body);
    const stamp = date ?? new Date().toISOString().slice(0, 10);
    const set: Record<string, unknown> = { status };
    if (status === "Cleared") set.clearedDate = stamp;
    if (status === "Voided") {
      set.voidedDate = stamp;
      set.voidReason = reason ?? "";
    }
    if (status === "Stopped") {
      set.stoppedDate = stamp;
      if (reason) set.voidReason = reason;
    }
    if (status === "Stale") set.staleDate = stamp;

    const [row] = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) =>
        tx
          .update(checkRegistry)
          .set(set)
          .where(and(eq(checkRegistry.orgId, auth.orgId), eq(checkRegistry.id, id)))
          .returning(),
    );
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ check: row });
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[checkStatus]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

checkRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const [row] = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .delete(checkRegistry)
        .where(and(eq(checkRegistry.orgId, auth.orgId), eq(checkRegistry.id, id)))
        .returning({ id: checkRegistry.id }),
  );
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
});
