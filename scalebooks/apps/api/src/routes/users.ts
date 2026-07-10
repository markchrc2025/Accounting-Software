import { Hono } from "hono";
import { ZodError } from "zod";
import { asc, eq } from "drizzle-orm";
import { zInviteUser } from "@scalebooks/domain";
import { withOrgContext, appUsers } from "@scalebooks/db";
import { requireAuth } from "../auth";

export const userRoutes = new Hono();

userRoutes.use("*", requireAuth);

function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505";
}

// The workspace's user allowlist (admin only).
userRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
    return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
  }
  const rows = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select({
          id: appUsers.id,
          email: appUsers.email,
          fullName: appUsers.fullName,
          role: appUsers.role,
          createdAt: appUsers.createdAt,
        })
        .from(appUsers)
        .where(eq(appUsers.orgId, auth.orgId))
        .orderBy(asc(appUsers.email)),
  );
  return c.json({ users: rows });
});

// Invite a user by email (admin only). They self-sign-up in Authenticize; only
// emails on this list are admitted to the workspace.
userRoutes.post("/", async (c) => {
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
    const input = zInviteUser.parse(body);
    const [created] = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) =>
        tx
          .insert(appUsers)
          .values({
            orgId: auth.orgId,
            email: input.email,
            fullName: input.fullName ?? null,
            role: input.role,
          })
          .returning({
            id: appUsers.id,
            email: appUsers.email,
            fullName: appUsers.fullName,
            role: appUsers.role,
            createdAt: appUsers.createdAt,
          }),
    );
    return c.json({ user: created }, 201);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    if (isUniqueViolation(err)) {
      return c.json({ error: "duplicate_email", detail: "That email is already on a workspace" }, 409);
    }
    console.error("[inviteUser]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
