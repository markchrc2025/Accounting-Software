/**
 * Per-request org context for Row-Level Security.
 *
 * `withOrgContext` opens a transaction and sets `app.current_org_id` /
 * `app.current_user_id` for its duration (via set_config(..., is_local = true)),
 * so the RLS policies in 0001_rls.sql scope every query to the caller's org.
 * All org-scoped reads and writes in the API must go through it.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";
import { userRole } from "./schema";

export type UserRole = (typeof userRole.enumValues)[number];

/** The drizzle transaction handle passed to the callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OrgContext {
  userId: string;
  orgId: string;
  role?: UserRole;
}

export async function withOrgContext<T>(
  ctx: OrgContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_role', ${ctx.role ?? ""}, true)`);
    return fn(tx);
  });
}

export interface ResolvedUser {
  userId: string;
  orgId: string;
  role: UserRole;
  email: string;
  fullName: string | null;
  orgCode: string;
  orgName: string;
}

/**
 * Resolve a user from their verified EMAIL against the app_users allowlist,
 * bypassing RLS via the SECURITY DEFINER function. Returns null if the email is
 * not on the allowlist (i.e. not provisioned in any org).
 */
export async function getUserContext(email: string): Promise<ResolvedUser | null> {
  const rows = (await db.execute(
    sql`SELECT user_id, org_id, role, email, full_name, org_code, org_name FROM get_user_context(${email}::text)`,
  )) as unknown as Array<{
    user_id: string;
    org_id: string;
    role: UserRole;
    email: string;
    full_name: string | null;
    org_code: string;
    org_name: string;
  }>;
  const r = rows[0];
  if (!r) return null;
  return {
    userId: r.user_id,
    orgId: r.org_id,
    role: r.role,
    email: r.email,
    fullName: r.full_name,
    orgCode: r.org_code,
    orgName: r.org_name,
  };
}
