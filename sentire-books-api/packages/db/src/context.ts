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

interface UserContextRow {
  user_id: string;
  org_id: string;
  role: UserRole;
  email: string;
  full_name: string | null;
  org_code: string;
  org_name: string;
}

const toResolvedUser = (r: UserContextRow): ResolvedUser => ({
  userId: r.user_id,
  orgId: r.org_id,
  role: r.role,
  email: r.email,
  fullName: r.full_name,
  orgCode: r.org_code,
  orgName: r.org_name,
});

/**
 * Every workspace the caller's verified EMAIL can access (an email may belong to
 * several). Bypasses RLS via the SECURITY DEFINER function. Empty if the email is
 * on no allowlist. Used to drive the post-login workspace picker.
 */
export async function getUserWorkspaces(email: string): Promise<ResolvedUser[]> {
  const rows = (await db.execute(
    sql`SELECT user_id, org_id, role, email, full_name, org_code, org_name FROM get_user_workspaces(${email}::text)`,
  )) as unknown as UserContextRow[];
  return rows.map(toResolvedUser);
}

/**
 * Resolve the caller's membership in ONE specific workspace, by verified email +
 * org id. Returns null if that email isn't provisioned in that org — so a caller
 * can never act in a workspace they don't belong to, even with a valid token.
 */
export async function getUserContext(
  email: string,
  orgId: string,
): Promise<ResolvedUser | null> {
  const rows = (await db.execute(
    sql`SELECT user_id, org_id, role, email, full_name, org_code, org_name FROM get_user_context(${email}::text, ${orgId}::uuid)`,
  )) as unknown as UserContextRow[];
  const r = rows[0];
  return r ? toResolvedUser(r) : null;
}
