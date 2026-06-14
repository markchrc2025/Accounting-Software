import type { Context, Next } from "hono";

/**
 * Authenticated caller derived from a verified JWT.
 * `role` mirrors the DB role and is also used for coarse authorization.
 */
export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  role: "maker" | "verifier" | "approver" | "poster" | "admin";
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

/**
 * Auth middleware.
 *
 * TODO(prod): verify the bearer token against the configured JWKS (AUTH_JWKS_URL)
 * and read `sub`, `org_id`, `role`, and `email` from the *verified* claims.
 * Never trust client-supplied identity. This stub exists so routes can be wired
 * and tested; it must be replaced before any real deployment.
 */
export async function requireAuth(c: Context, next: Next) {
  const userId = c.req.header("x-user-id");
  const orgId = c.req.header("x-org-id");
  const email = c.req.header("x-user-email") ?? "";
  const role = (c.req.header("x-user-role") ?? "maker") as AuthContext["role"];

  if (!userId || !orgId) {
    return c.json({ error: "unauthenticated" }, 401);
  }
  c.set("auth", { userId, orgId, email, role });
  await next();
}

const POSTERS: AuthContext["role"][] = ["poster", "admin"];

/** Coarse role gate for actions that write to the ledger. */
export function canPost(role: AuthContext["role"]): boolean {
  return POSTERS.includes(role);
}
