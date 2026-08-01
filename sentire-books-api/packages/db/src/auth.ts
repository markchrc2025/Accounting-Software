/**
 * Local sign-in credentials for Sentire Books.
 *
 * Books owns its own passwords. Credentials are keyed by (lowercased) EMAIL —
 * the identity, not a workspace — so an email that belongs to several
 * workspaces still has exactly ONE password. The table is NOT org-scoped, so it
 * has no Row-Level Security; it's read during sign-in, before any workspace is
 * chosen.
 *
 * Managed as a raw table (created on API boot via `ensureAuthTables`) rather
 * than through the Drizzle schema, so it stays out of the org-scoped migration
 * set and its RLS policies.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";

const norm = (email: string) => email.trim().toLowerCase();

/** Create the credentials table if it doesn't exist. Idempotent; run on boot. */
export async function ensureAuthTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS credentials (
      email text PRIMARY KEY,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // M0.4 lockout state. Added here rather than in a migration because the whole
  // table lives outside the org-scoped migration set (see the file header).
  // TODO(M6.3): move `credentials` — including these columns — into the
  // versioned migrations so the password store stops being created by raw DDL.
  await db.execute(sql`
    ALTER TABLE credentials
      ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS locked_until timestamptz
  `);
}

export interface CredentialRecord {
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
}

/** The full sign-in record for an email, or null when unknown. */
export async function getCredential(email: string): Promise<CredentialRecord | null> {
  const rows = (await db.execute(sql`
    SELECT password_hash, failed_attempts, locked_until
    FROM credentials WHERE email = ${norm(email)}
  `)) as unknown as {
    password_hash: string;
    failed_attempts: number;
    locked_until: Date | string | null;
  }[];
  const row = rows[0];
  if (!row) return null;
  return {
    passwordHash: row.password_hash,
    failedAttempts: Number(row.failed_attempts ?? 0),
    lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
  };
}

/**
 * Count one failed sign-in and lock the credential until `lockUntil` when the
 * caller decides the threshold was crossed. Returns the new failure count.
 */
export async function recordFailedSignIn(
  email: string,
  lockUntil: Date | null,
): Promise<number> {
  const rows = (await db.execute(sql`
    UPDATE credentials
       SET failed_attempts = failed_attempts + 1,
           locked_until = ${lockUntil}
     WHERE email = ${norm(email)}
     RETURNING failed_attempts
  `)) as unknown as { failed_attempts: number }[];
  return Number(rows[0]?.failed_attempts ?? 0);
}

/** Clear lockout state after a successful sign-in. */
export async function clearFailedSignIns(email: string): Promise<void> {
  await db.execute(sql`
    UPDATE credentials
       SET failed_attempts = 0, locked_until = NULL
     WHERE email = ${norm(email)} AND (failed_attempts <> 0 OR locked_until IS NOT NULL)
  `);
}

/** The stored password hash for an email identity, or null if none is set. */
export async function getPasswordHash(email: string): Promise<string | null> {
  const rows = (await db.execute(
    sql`SELECT password_hash FROM credentials WHERE email = ${norm(email)}`,
  )) as unknown as { password_hash: string }[];
  return rows[0]?.password_hash ?? null;
}

/** Create or replace the password hash for an email identity. */
export async function setPasswordHash(email: string, passwordHash: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO credentials (email, password_hash, updated_at)
    VALUES (${norm(email)}, ${passwordHash}, now())
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash, updated_at = now()
  `);
}

/** Whether an email identity has a password set. */
export async function hasCredential(email: string): Promise<boolean> {
  return (await getPasswordHash(email)) !== null;
}
