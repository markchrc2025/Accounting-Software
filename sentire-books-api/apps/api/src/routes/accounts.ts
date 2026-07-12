import { Hono } from "hono";
import { ZodError } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { zAccountInput, zAccountUpdate, zImportAccounts, normalBalanceFor } from "@sentire-books/domain";
import { withOrgContext, accounts } from "@sentire-books/db";
import { requireAuth } from "../auth";

export const accountRoutes = new Hono();

accountRoutes.use("*", requireAuth);

// List the caller's chart of accounts.
accountRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const rows = await withOrgContext({ userId: auth.userId, orgId: auth.orgId, role: auth.role }, (tx) =>
    tx.select().from(accounts).where(eq(accounts.orgId, auth.orgId)).orderBy(asc(accounts.code)),
  );
  return c.json({ accounts: rows });
});

// Create a new account (admin only).
accountRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
    return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const input = zAccountInput.parse(body);

    const created = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const existing = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.orgId, auth.orgId), eq(accounts.name, input.name)));
        if (existing.length > 0) return null;

        const [row] = await tx
          .insert(accounts)
          .values({
            orgId: auth.orgId,
            code: input.code,
            name: input.name,
            type: input.type,
            subtype: input.subtype ?? null,
            description: input.description ?? null,
            normalBalance: normalBalanceFor(input.type),
            isActive: input.isActive,
          })
          .returning();
        return row;
      },
    );

    if (!created) {
      return c.json({ error: "duplicate_name", detail: `Account "${input.name}" already exists` }, 409);
    }
    return c.json({ account: created }, 201);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    console.error("[createAccount]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Update an account (admin only). Partial: omitted fields are left unchanged.
accountRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
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
    const input = zAccountUpdate.parse(body);
    const set: Record<string, unknown> = {};
    if (input.code !== undefined) set.code = input.code;
    if (input.name !== undefined) set.name = input.name;
    if (input.type !== undefined) {
      set.type = input.type;
      set.normalBalance = normalBalanceFor(input.type);
    }
    if (input.subtype !== undefined) set.subtype = input.subtype;
    if (input.description !== undefined) set.description = input.description;
    if (input.isActive !== undefined) set.isActive = input.isActive;
    if (Object.keys(set).length === 0) {
      return c.json({ error: "no_fields", detail: "Nothing to update" }, 400);
    }

    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        if (typeof set.name === "string") {
          const dup = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.orgId, auth.orgId), eq(accounts.name, set.name as string)));
          if (dup.length > 0 && dup[0]!.id !== id) return { conflict: true as const };
        }
        const [row] = await tx
          .update(accounts)
          .set(set)
          .where(and(eq(accounts.orgId, auth.orgId), eq(accounts.id, id)))
          .returning();
        return { row };
      },
    );

    if ("conflict" in outcome) {
      return c.json({ error: "duplicate_name", detail: "Another account already has that name" }, 409);
    }
    if (!outcome.row) return c.json({ error: "not_found" }, 404);
    return c.json({ account: outcome.row });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    console.error("[updateAccount]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Delete an account (admin only). Blocked if the account has postings (FK).
accountRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
    return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
  }
  const id = c.req.param("id");

  try {
    const deleted = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [row] = await tx
          .delete(accounts)
          .where(and(eq(accounts.orgId, auth.orgId), eq(accounts.id, id)))
          .returning({ id: accounts.id });
        return row;
      },
    );
    if (!deleted) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23503") {
      return c.json(
        { error: "account_in_use", detail: "This account has postings and can't be deleted. Deactivate it instead." },
        409,
      );
    }
    console.error("[deleteAccount]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Bulk-import a chart of accounts (admin only) — e.g. from an uploaded Excel that
// the web app parsed into rows. Idempotent: existing accounts (by name) are
// skipped, and the parent hierarchy is resolved by name in the same transaction.
accountRoutes.post("/import", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
    return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const { accounts: rows } = zImportAccounts.parse(body);
    // De-dupe within the upload by name (name is the org-unique key).
    const byName = new Map(rows.map((r) => [r.name, r]));
    const unique = [...byName.values()];

    const result = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const inserted = await tx
          .insert(accounts)
          .values(
            unique.map((a) => ({
              orgId: auth.orgId,
              code: a.code,
              name: a.name,
              type: a.type,
              subtype: a.subtype ?? null,
              description: a.description ?? null,
              normalBalance: a.normalBalance ?? normalBalanceFor(a.type),
            })),
          )
          .onConflictDoNothing({ target: [accounts.orgId, accounts.name] })
          .returning({ id: accounts.id });

        // Resolve parents by name (accounts just inserted + any pre-existing).
        const all = await tx
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(eq(accounts.orgId, auth.orgId));
        const idByName = new Map(all.map((r) => [r.name, r.id]));

        let linked = 0;
        for (const a of unique) {
          if (!a.parentName) continue;
          const parentId = idByName.get(a.parentName);
          if (!parentId || !idByName.has(a.name)) continue;
          await tx
            .update(accounts)
            .set({ parentId })
            .where(and(eq(accounts.orgId, auth.orgId), eq(accounts.name, a.name)));
          linked++;
        }
        return { inserted: inserted.length, total: unique.length, linked };
      },
    );

    return c.json({ ...result, skipped: result.total - result.inserted }, 200);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    console.error("[importAccounts]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
