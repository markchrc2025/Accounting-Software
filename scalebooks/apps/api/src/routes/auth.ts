import { Hono } from "hono";
import { getUserWorkspaces } from "@scalebooks/db";
import { requireAuth, requireIdentity } from "../auth";

export const authRoutes = new Hono();

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
authRoutes.get("/me", requireAuth, (c) => {
  const a = c.get("auth");
  return c.json({
    user: { id: a.userId, email: a.email },
    org: { id: a.orgId, name: a.orgName, code: a.orgCode },
    role: a.role,
  });
});
