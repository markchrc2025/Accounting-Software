import type { Context, Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getUserContext, getUserWorkspaces, type UserRole } from "@scalebooks/db";

/**
 * Authenticated caller resolved for a SPECIFIC workspace. `orgId`/`role` come
 * from the DB (app_users) keyed by the verified token email + the requested org
 * — never trusted from client-supplied claims, so a forged or stale role in a
 * token cannot escalate privileges, and a caller can only ever act in a
 * workspace their email actually belongs to.
 */
export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
  role: UserRole;
  orgCode: string;
  orgName: string;
}

/** Just the verified identity, before a workspace is chosen. */
export interface Identity {
  email: string;
  sub: string;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
    identity: Identity;
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

/** Verify the token and pin the caller's identity (email) — no workspace yet. */
export async function requireIdentity(c: Context, next: Next) {
  const id = await resolveIdentity(c);
  if (!id) return c.json({ error: "unauthenticated" }, 401);
  if (!id.email) {
    return c.json({ error: "unauthenticated", detail: "Token has no email claim" }, 401);
  }
  c.set("identity", { email: id.email, sub: id.uid });
  await next();
}

/**
 * Verify the token AND resolve the caller within a specific workspace. The active
 * workspace is chosen by the client via the `x-org-id` header (from the post-login
 * picker). When it's omitted we fall back gracefully: if the email belongs to
 * exactly one workspace we use it; if it belongs to several we ask the client to
 * choose (409); if none, it's forbidden.
 */
export async function requireAuth(c: Context, next: Next) {
  const id = await resolveIdentity(c);
  if (!id) return c.json({ error: "unauthenticated" }, 401);
  if (!id.email) {
    return c.json({ error: "unauthenticated", detail: "Token has no email claim" }, 401);
  }

  // Authenticize authenticates; Sentire owns its users. Admit by verified email
  // against the app_users allowlist — never by the provider's internal id.
  const requestedOrg = c.req.header("x-org-id");
  let ctx;
  if (requestedOrg) {
    ctx = await getUserContext(id.email, requestedOrg);
    if (!ctx) {
      return c.json(
        { error: "forbidden", detail: "You don't have access to this workspace" },
        403,
      );
    }
  } else {
    const workspaces = await getUserWorkspaces(id.email);
    if (workspaces.length === 0) {
      return c.json(
        { error: "forbidden", detail: "This account isn't on any workspace's user list" },
        403,
      );
    }
    if (workspaces.length > 1) {
      return c.json(
        {
          error: "workspace_selection_required",
          detail: "Choose a workspace",
          workspaces: workspaces.map((w) => ({
            id: w.orgId,
            code: w.orgCode,
            name: w.orgName,
            role: w.role,
          })),
        },
        409,
      );
    }
    ctx = workspaces[0]!;
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
