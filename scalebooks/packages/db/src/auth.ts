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
