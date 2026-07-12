import { Hono } from "hono";
import { ZodError, z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { zInviteUser, zUserUpdate } from "@sentire-books/domain";
import { withOrgContext, appUsers } from "@sentire-books/db";
import { requireAuth } from "../auth";
import { setPassword } from "../password";

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
          profile: appUsers.profile,
          createdAt: appUsers.createdAt,
        })
        .from(appUsers)
        .where(eq(appUsers.orgId, auth.orgId))
        .orderBy(asc(appUsers.email)),
  );
  return c.json({ users: rows });
});

// Add a user to the workspace allowlist by email (admin only). Set their
// sign-in password separately via POST /:id/password.
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
            profile: input.profile ?? null,
          })
          .returning({
            id: appUsers.id,
            email: appUsers.email,
            fullName: appUsers.fullName,
            role: appUsers.role,
            profile: appUsers.profile,
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

// Admin edit: full name, role, portal profile bag. Email is immutable (it is
// the allowlist key — delete + re-invite to change it).
userRoutes.put("/:id", async (c) => {
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
    const input = zUserUpdate.parse(body);
    const set: Record<string, unknown> = {};
    if (input.fullName !== undefined) set.fullName = input.fullName;
    if (input.role !== undefined) set.role = input.role;
    if (input.profile !== undefined) set.profile = input.profile;
    if (Object.keys(set).length === 0) return c.json({ error: "no_fields" }, 400);
    const [row] = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) =>
        tx
          .update(appUsers)
          .set(set)
          .where(and(eq(appUsers.orgId, auth.orgId), eq(appUsers.id, id)))
          .returning({
            id: appUsers.id,
            email: appUsers.email,
            fullName: appUsers.fullName,
            role: appUsers.role,
            profile: appUsers.profile,
            createdAt: appUsers.createdAt,
          }),
    );
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ user: row });
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[updateUser]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Admin removal from the workspace allowlist (their sign-in credential remains;
// they just can't enter this workspace anymore).
userRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
    return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
  }
  const id = c.req.param("id");
  if (id === auth.userId) {
    return c.json({ error: "self_delete", detail: "You cannot remove yourself" }, 400);
  }
  try {
    const [row] = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) =>
        tx
          .delete(appUsers)
          .where(and(eq(appUsers.orgId, auth.orgId), eq(appUsers.id, id)))
          .returning({ id: appUsers.id }),
    );
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23503") {
      return c.json({ error: "in_use", detail: "This user is referenced by existing records." }, 409);
    }
    console.error("[deleteUser]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

const zSetPassword = z.object({ password: z.string().min(8) });

// Set (or reset) a workspace member's sign-in password (admin only). Keyed by
// the user's id within the admin's workspace, so an admin can only set
// passwords for members of their own workspace. Credentials are per-email, so
// this is the person's password everywhere they're a member.
userRoutes.post("/:id/password", async (c) => {
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
  const parsed = zSetPassword.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation_error", issues: parsed.error.issues }, 400);
  }

  const id = c.req.param("id");
  const rows = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select({ email: appUsers.email })
        .from(appUsers)
        .where(and(eq(appUsers.id, id), eq(appUsers.orgId, auth.orgId))),
  );
  const target = rows[0];
  if (!target) {
    return c.json({ error: "not_found", detail: "No such user in this workspace" }, 404);
  }

  await setPassword(target.email, parsed.data.password);
  return c.json({ ok: true });
});
