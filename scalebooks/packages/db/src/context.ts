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
  orgId: string;
  role: UserRole;
  email: string;
  fullName: string | null;
}

/**
 * Resolve a user's org + role from their auth uid, bypassing RLS via the
 * SECURITY DEFINER function. Returns null if the user is not provisioned.
 */
export async function getUserContext(uid: string): Promise<ResolvedUser | null> {
  const rows = (await db.execute(
    sql`SELECT org_id, role, email, full_name FROM get_user_context(${uid}::uuid)`,
  )) as unknown as Array<{
    org_id: string;
    role: UserRole;
    email: string;
    full_name: string | null;
  }>;
  const r = rows[0];
  if (!r) return null;
  return { orgId: r.org_id, role: r.role, email: r.email, fullName: r.full_name };
}
