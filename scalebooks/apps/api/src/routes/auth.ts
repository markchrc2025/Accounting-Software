import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { getUserWorkspaces, withOrgContext, appUsers } from "@scalebooks/db";
import { requireAuth, requireIdentity } from "../auth";
import { passwordSignIn } from "../password";

export const authRoutes = new Hono();

// In-app email/password sign-in (public). Verifies against Sentire Books' own
// credentials and returns a JWT the SPA uses as a Bearer token. The workspace is
// then resolved as usual (the form's company code selects it).
authRoutes.post("/password", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const email = typeof (body as { email?: unknown })?.email === "string" ? (body as { email: string }).email.trim() : "";
  const password =
    typeof (body as { password?: unknown })?.password === "string" ? (body as { password: string }).password : "";
  if (!email || !password) return c.json({ error: "missing_credentials" }, 400);

  const result = await passwordSignIn(email, password);
  if ("error" in result) return c.json({ error: result.error }, result.status as 401 | 502);
  return c.json({ token: result.token });
});

// Every workspace the signed-in identity can access. Needs only a valid token
// (no workspace chosen yet) — the web app calls this right after login to decide
// whether to auto-enter the single workspace or show a picker.
authRoutes.get("/workspaces", requireIdentity, async (c) => {
  const { email } = c.get("identity");
  const workspaces = await getUserWorkspaces(email);
  return c.json({
    email,
    workspaces: workspaces.map((w) => ({
      id: w.orgId,
      code: w.orgCode,
      name: w.orgName,
      role: w.role,
    })),
  });
});

// The signed-in user's identity, resolved for the ACTIVE workspace (chosen via
// the x-org-id header) and their role in it.
authRoutes.get("/me", requireAuth, async (c) => {
  const a = c.get("auth");
  // The profile card needs a display name; fetch it from the allowlist row.
  const [row] = await withOrgContext(
    { userId: a.userId, orgId: a.orgId, role: a.role },
    (tx) =>
      tx
        .select({ fullName: appUsers.fullName, profile: appUsers.profile })
        .from(appUsers)
        .where(and(eq(appUsers.orgId, a.orgId), eq(appUsers.id, a.userId))),
  );
  return c.json({
    user: {
      id: a.userId,
      email: a.email,
      fullName: row?.fullName ?? null,
      profile: row?.profile ?? null,
    },
    org: { id: a.orgId, name: a.orgName, code: a.orgCode },
    role: a.role,
  });
});
