/**
 * Local sign-in credentials for Sentire Books.
 *
 * Books owns its own passwords. Credentials are keyed by (lowercased) EMAIL —
 * the identity, not a workspace — so an email that belongs to several
 * workspaces still has exactly ONE password. The table is NOT org-scoped, so it
 * has no Row-Level Security; it's read during sign-in, before any workspace is
 * chosen.
 *
 * Owned by migration `0022_credentials.sql` — NOT by the Drizzle schema, so it
 * stays out of the org-scoped RLS policies. It was previously created at API
 * boot by raw DDL, which could never succeed: the API connects as
 * `sentire_books_app`, which holds only USAGE on schema public, so the CREATE
 * failed with "permission denied for schema public" every boot (swallowed by
 * boot()'s catch). Migrations run as the owner, which is where DDL belongs.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";

const norm = (email: string) => email.trim().toLowerCase();

/**
 * Whether `credentials` carries the M0.4 lockout columns. Probed once at boot.
 * `null` = not yet probed.
 *
 * The table and its columns are owned by migration `0022_credentials.sql`. If
 * that migration (or `setup/livedbdelta0022.sql`) has not been applied, the
 * columns are absent — so every query below degrades instead of throwing. A
 * missed delta must never take sign-in down.
 */
let lockoutColumns: boolean | null = null;

/**
 * Probe for the lockout columns and cache the answer. Returns false when they
 * are missing, so the caller can warn and fall back to in-memory-only
 * throttling.
 */
export async function detectLockoutColumns(): Promise<boolean> {
  try {
    const rows = (await db.execute(sql`
      SELECT count(*)::int AS n
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'credentials'
         AND column_name IN ('failed_attempts', 'locked_until')
    `)) as unknown as { n: number }[];
    lockoutColumns = Number(rows[0]?.n ?? 0) === 2;
  } catch {
    lockoutColumns = false;
  }
  return lockoutColumns;
}

/** Cached answer; probes on first use if boot hasn't already. */
async function hasLockoutColumns(): Promise<boolean> {
  return lockoutColumns ?? (await detectLockoutColumns());
}

/** Whether durable lockout is active (false ⇒ in-memory throttling only). */
export function lockoutColumnsAvailable(): boolean {
  return lockoutColumns === true;
}

export interface CredentialRecord {
  passwordHash: string;
  failedAttempts: number;
  lockedUntil: Date | null;
}

/**
 * The full sign-in record for an email, or null when unknown.
 *
 * Selects the lockout columns ONLY when they exist; otherwise it reads just the
 * hash and reports "never failed, not locked", so sign-in still works on a
 * database that hasn't had the 0022 delta applied.
 */
export async function getCredential(email: string): Promise<CredentialRecord | null> {
  const withLockout = await hasLockoutColumns();
  if (!withLockout) {
    const hash = await getPasswordHash(email);
    return hash === null ? null : { passwordHash: hash, failedAttempts: 0, lockedUntil: null };
  }
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
 * Count one failed sign-in, locking the credential until `lockUntil` when the
 * caller decides the threshold was crossed. Returns the new failure count, or 0
 * when the lockout columns are absent (a no-op in that case).
 */
export async function recordFailedSignIn(
  email: string,
  lockUntil: Date | null,
): Promise<number> {
  if (!(await hasLockoutColumns())) return 0;
  // Bind an ISO string, not a Date: postgres-js cannot serialize a Date through
  // drizzle's raw `sql` template, and throws ERR_INVALID_ARG_TYPE at bind time.
  const lockIso = lockUntil ? lockUntil.toISOString() : null;
  const rows = (await db.execute(sql`
    UPDATE credentials
       SET failed_attempts = failed_attempts + 1,
           locked_until = ${lockIso}::timestamptz
     WHERE email = ${norm(email)}
     RETURNING failed_attempts
  `)) as unknown as { failed_attempts: number }[];
  return Number(rows[0]?.failed_attempts ?? 0);
}

/** Clear lockout state after a successful sign-in. No-op without the columns. */
export async function clearFailedSignIns(email: string): Promise<void> {
  if (!(await hasLockoutColumns())) return;
  await db.execute(sql`
    UPDATE credentials
       SET failed_attempts = 0, locked_until = NULL
     WHERE email = ${norm(email)} AND (failed_attempts <> 0 OR locked_until IS NOT NULL)
  `);
}

/** Test seam: forget the cached probe result. */
export function __resetLockoutProbe(): void {
  lockoutColumns = null;
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
