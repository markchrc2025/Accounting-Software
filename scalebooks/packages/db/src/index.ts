import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const rawUrl = process.env.DATABASE_URL ?? "";
if (!rawUrl) {
  // Don't throw at import time — that would break test collection. Queries will
  // fail clearly once attempted if the URL is genuinely missing.
  console.warn("[db] DATABASE_URL not set — queries will fail until it is configured.");
}

// postgres-js doesn't understand the non-standard `sslmode=no-verify` token some
// managed hosts (e.g. Sliplane) emit. Translate `sslmode` into an explicit `ssl`
// option and strip it from the URL, so TLS to a self-signed / TLS-proxied server
// works. URLs without `sslmode` (CI, local, Supabase pooler) are left untouched.
type SslOption = boolean | "require" | { rejectUnauthorized: boolean };

function resolveConnection(url: string): { url: string; ssl?: SslOption } {
  if (!url) return { url };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url }; // not URL-parseable — pass through verbatim
  }
  const mode = (parsed.searchParams.get("sslmode") ?? "").toLowerCase();
  if (!mode) return { url };
  parsed.searchParams.delete("sslmode");
  const cleaned = parsed.toString();
  switch (mode) {
    case "disable":
      return { url: cleaned, ssl: false };
    case "no-verify":
    case "require":
      // Encrypt, but don't fail on an unverifiable (self-signed / proxied) cert.
      return { url: cleaned, ssl: { rejectUnauthorized: false } };
    case "verify-ca":
    case "verify-full":
      return { url: cleaned, ssl: "require" };
    default: // prefer / allow / unknown → let postgres-js use its default
      return { url: cleaned };
  }
}

const conn = resolveConnection(rawUrl);
// Single shared pool for the app.
const client =
  conn.ssl === undefined
    ? postgres(conn.url, { prepare: false })
    : postgres(conn.url, { prepare: false, ssl: conn.ssl });

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
export * from "./schema";
export * from "./context";
export * from "./auth";
export * from "./demo";
