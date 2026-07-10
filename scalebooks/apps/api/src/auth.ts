import type { Context, Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getUserContext, type UserRole } from "@scalebooks/db";

/**
 * Authenticated caller. `orgId`/`role` are resolved from the DB (app_users) by
 * the verified token's `sub` — never trusted from client-supplied claims, so a
 * forged or stale role in a token cannot escalate privileges.
 */
export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  role: UserRole;
  orgCode: string;
  orgName: string;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  const url = process.env.AUTH_JWKS_URL;
  if (!url) return null;
  if (!_jwks) _jwks = createRemoteJWKSet(new URL(url));
  return _jwks;
}

/** Verify the bearer token (prod) or read a dev header (local only). */
async function resolveIdentity(c: Context): Promise<{ uid: string; email: string } | null> {
  const jwks = getJwks();
  if (jwks) {
    const authz = c.req.header("authorization") ?? "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
    if (!token) return null;
    try {
      const issuer = process.env.AUTH_ISSUER;
      const { payload } = await jwtVerify(token, jwks, issuer ? { issuer } : undefined);
      if (!payload.sub) return null;
      return { uid: payload.sub, email: typeof payload.email === "string" ? payload.email : "" };
    } catch {
      return null;
    }
  }

  // Dev-only fallback when no IdP is configured. NEVER set AUTH_DEV_BYPASS=true
  // in production — it trusts an unauthenticated header.
  if (process.env.AUTH_DEV_BYPASS === "true") {
    const uid = c.req.header("x-user-id");
    if (!uid) return null;
    return { uid, email: c.req.header("x-user-email") ?? "" };
  }

  return null;
}

export async function requireAuth(c: Context, next: Next) {
  const id = await resolveIdentity(c);
  if (!id) return c.json({ error: "unauthenticated" }, 401);
  if (!id.email) {
    return c.json({ error: "unauthenticated", detail: "Token has no email claim" }, 401);
  }

  // Authenticize authenticates; Sentire owns its users. Admit by verified email
  // against the app_users allowlist — never by the provider's internal id.
  const ctx = await getUserContext(id.email);
  if (!ctx) {
    return c.json(
      { error: "forbidden", detail: "This account isn't on the workspace's user list" },
      403,
    );
  }

  c.set("auth", {
    userId: ctx.userId,
    orgId: ctx.orgId,
    email: ctx.email,
    role: ctx.role,
    orgCode: ctx.orgCode,
    orgName: ctx.orgName,
  });
  await next();
}

const POSTERS: readonly UserRole[] = ["poster", "admin"];

/** Coarse role gate for actions that write to the ledger. */
export function canPost(role: UserRole): boolean {
  return POSTERS.includes(role);
}
