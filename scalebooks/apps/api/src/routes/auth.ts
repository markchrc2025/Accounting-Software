import { Hono } from "hono";
import { requireAuth } from "../auth";

export const authRoutes = new Hono();

authRoutes.use("*", requireAuth);

// The signed-in user's identity, resolved org (id, name, tenant code) and role.
// The web app calls this after sign-in to confirm the entered company code
// matches the user's workspace.
authRoutes.get("/me", (c) => {
  const a = c.get("auth");
  return c.json({
    user: { id: a.userId, email: a.email },
    org: { id: a.orgId, name: a.orgName, code: a.orgCode },
    role: a.role,
  });
});
