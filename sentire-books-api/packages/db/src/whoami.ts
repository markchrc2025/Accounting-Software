/**
 * Report the database identity the API actually connects as.
 *
 * Uses the API's OWN pool (`db`, built from DATABASE_URL exactly as the running
 * server builds it), so the answer reflects production reality rather than a
 * psql session opened by hand.
 *
 *   DATABASE_URL="<the API's DATABASE_URL>" pnpm --filter @sentire-books/db whoami
 *
 * Expected: current_user = session_user = sentire_books_app, non-superuser,
 * without BYPASSRLS. Anything else — especially an owner or superuser — means
 * Row-Level Security is NOT being enforced for the API's connection, and tenant
 * isolation would rest on application filtering alone. Exits non-zero so it can
 * be used as a deployment check.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";

const EXPECTED_ROLE = "sentire_books_app";

interface IdentityRow {
  current_user: string;
  session_user: string;
  is_superuser: boolean | null;
  bypassrls: boolean | null;
  database: string;
}

async function main(): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT current_user,
           session_user,
           (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user) AS is_superuser,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls,
           current_database() AS database
  `)) as unknown as IdentityRow[];

  const r = rows[0]!;
  console.log("database      :", r.database);
  console.log("current_user  :", r.current_user);
  console.log("session_user  :", r.session_user);
  console.log("is_superuser  :", r.is_superuser);
  console.log("bypassrls     :", r.bypassrls);
  console.log("");

  const ok =
    r.current_user === EXPECTED_ROLE &&
    r.session_user === EXPECTED_ROLE &&
    !r.is_superuser &&
    !r.bypassrls;

  console.log(
    ok
      ? `✅ OK — the API runs as ${EXPECTED_ROLE}; Row-Level Security applies to every query.`
      : `❌ CRITICAL — expected ${EXPECTED_ROLE}, got ${r.current_user}. RLS is NOT enforced for ` +
          "this connection; tenant isolation would depend on application filtering alone.",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("whoami failed:", e);
  process.exit(2);
});
