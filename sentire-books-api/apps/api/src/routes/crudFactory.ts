/**
 * Generic org-scoped CRUD router. The remaining portal domains are simple
 * documents (tax rates, bank balances, billing statements, …) that all need the
 * same surface: list (org-scoped, ordered), create, partial update, delete —
 * with RLS via withOrgContext and zod validation. Building each by hand would
 * be ~150 duplicated lines per resource; this factory generates them.
 */
import { Hono } from "hono";
import { ZodError, type ZodTypeAny } from "zod";
import { and, asc, desc, eq, sql, type AnyColumn } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { withOrgContext, type Tx } from "@sentire-books/db";
import { requireAuth } from "../auth";

type AnyTable = PgTable & {
  id: AnyColumn;
  orgId: AnyColumn;
};

export interface CrudOptions {
  /** Response envelope key, e.g. "rates" → { rates: [...] } / { rate: {...} }. */
  plural: string;
  singular: string;
  table: AnyTable;
  createSchema: ZodTypeAny;
  updateSchema: ZodTypeAny;
  /** Columns to ORDER BY (desc by default). */
  orderBy?: { column: AnyColumn; dir?: "asc" | "desc" }[];
  /** Stamp created_by from the caller (default true; table must have the column). */
  stampCreatedBy?: boolean;
  /**
   * Server-assigned document number: { field, prefix } → PREFIX{YYYYMM}-####
   * when absent. When dateField names a YYYY-MM-DD column in the payload, the
   * period comes from the document's own date instead of "now".
   */
  docNo?: { field: string; prefix: string; dateField?: string };
  /** Mutations require the admin role (reads stay open to members). */
  adminWrites?: boolean;
}

export async function nextDocNo(
  tx: Tx,
  orgId: string,
  prefix: string,
  docDate?: string,
): Promise<string> {
  const parsed = docDate ? new Date(`${docDate}T00:00:00Z`) : new Date();
  const now = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const periodKey = `${prefix}${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const counter = (await tx.execute(sql`
    INSERT INTO document_counters (org_id, period_key, seq)
    VALUES (${orgId}, ${periodKey}, 1)
    ON CONFLICT (org_id, period_key)
    DO UPDATE SET seq = document_counters.seq + 1
    RETURNING seq
  `)) as unknown as Array<{ seq: number }>;
  return `${periodKey}-${String(counter[0]!.seq).padStart(4, "0")}`;
}

const isUniqueViolation = (err: unknown): boolean =>
  !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505";
const isFkViolation = (err: unknown): boolean =>
  !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23503";

export function makeCrudRoutes(opts: CrudOptions): Hono {
  const { table, plural, singular } = opts;
  const app = new Hono();
  app.use("*", requireAuth);

  const hasColumn = (name: string) => name in table;

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const rows = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) => {
        let q = tx
          .select()
          .from(table as PgTable)
          .where(eq(table.orgId, auth.orgId))
          .$dynamic();
        const order = (opts.orderBy ?? []).map((o) =>
          o.dir === "asc" ? asc(o.column) : desc(o.column),
        );
        if (order.length) q = q.orderBy(...order);
        return q.limit(1000);
      },
    );
    return c.json({ [plural]: rows });
  });

  app.post("/", async (c) => {
    const auth = c.get("auth");
    if (opts.adminWrites && auth.role !== "admin") {
      return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    try {
      const input = opts.createSchema.parse(body) as Record<string, unknown>;
      const [row] = await withOrgContext(
        { userId: auth.userId, orgId: auth.orgId, role: auth.role },
        async (tx) => {
          const values: Record<string, unknown> = { ...input, orgId: auth.orgId };
          if (opts.docNo && !values[opts.docNo.field]) {
            const raw = opts.docNo.dateField ? values[opts.docNo.dateField] : undefined;
            values[opts.docNo.field] = await nextDocNo(
              tx,
              auth.orgId,
              opts.docNo.prefix,
              typeof raw === "string" ? raw : undefined,
            );
          }
          if (opts.stampCreatedBy !== false && hasColumn("createdBy")) {
            values.createdBy = auth.userId;
          }
          return tx
            .insert(table as PgTable)
            .values(values as never)
            .returning();
        },
      );
      return c.json({ [singular]: row }, 201);
    } catch (err) {
      if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
      if (isUniqueViolation(err)) return c.json({ error: "duplicate", detail: `That ${singular} already exists` }, 409);
      console.error(`[create ${singular}]`, err);
      return c.json({ error: "internal_error" }, 500);
    }
  });

  app.put("/:id", async (c) => {
    const auth = c.get("auth");
    if (opts.adminWrites && auth.role !== "admin") {
      return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
    }
    const id = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    try {
      const input = opts.updateSchema.parse(body) as Record<string, unknown>;
      const set: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) if (v !== undefined) set[k] = v;
      if (Object.keys(set).length === 0) return c.json({ error: "no_fields" }, 400);
      const [row] = await withOrgContext(
        { userId: auth.userId, orgId: auth.orgId, role: auth.role },
        (tx) =>
          tx
            .update(table as PgTable)
            .set(set as never)
            .where(and(eq(table.orgId, auth.orgId), eq(table.id, id)))
            .returning(),
      );
      if (!row) return c.json({ error: "not_found" }, 404);
      return c.json({ [singular]: row });
    } catch (err) {
      if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
      if (isUniqueViolation(err)) return c.json({ error: "duplicate", detail: `That ${singular} already exists` }, 409);
      console.error(`[update ${singular}]`, err);
      return c.json({ error: "internal_error" }, 500);
    }
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    if (opts.adminWrites && auth.role !== "admin") {
      return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
    }
    const id = c.req.param("id");
    try {
      const [row] = await withOrgContext(
        { userId: auth.userId, orgId: auth.orgId, role: auth.role },
        (tx) =>
          tx
            .delete(table as PgTable)
            .where(and(eq(table.orgId, auth.orgId), eq(table.id, id)))
            .returning(),
      );
      if (!row) return c.json({ error: "not_found" }, 404);
      return c.json({ ok: true });
    } catch (err) {
      if (isFkViolation(err)) {
        return c.json({ error: "in_use", detail: `This ${singular} is referenced by other records.` }, 409);
      }
      console.error(`[delete ${singular}]`, err);
      return c.json({ error: "internal_error" }, 500);
    }
  });

  return app;
}
