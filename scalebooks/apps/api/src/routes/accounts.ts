import { Hono } from "hono";
import { ZodError } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { zAccountInput } from "@scalebooks/domain";
import { withOrgContext, accounts } from "@scalebooks/db";
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
          .where(and(eq(accounts.orgId, auth.orgId), eq(accounts.code, input.code)));
        if (existing.length > 0) return null;

        const [row] = await tx
          .insert(accounts)
          .values({
            orgId: auth.orgId,
            code: input.code,
            name: input.name,
            type: input.type,
            isActive: input.isActive,
          })
          .returning();
        return row;
      },
    );

    if (!created) {
      return c.json({ error: "duplicate_code", detail: `Account ${input.code} already exists` }, 409);
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
