/**
 * Seed a demo organization, an admin user, and the standard chart of accounts.
 * Idempotent: fixed IDs + ON CONFLICT DO NOTHING, so it is safe to re-run.
 *
 *   pnpm --filter @sentire-books/db seed
 */
import { and, eq } from "drizzle-orm";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@sentire-books/domain";
import { db } from "./index";
import { organizations, appUsers, accounts } from "./schema";
import { DEMO_ORG_ID, DEMO_ADMIN_ID, DEMO_ADMIN_EMAIL } from "./demo";

async function seed() {
  console.log("Seeding demo organization…");

  await db
    .insert(organizations)
    .values({ id: DEMO_ORG_ID, name: "Demo Company Inc.", code: "DEMO" })
    .onConflictDoNothing({ target: organizations.id });

  await db
    .insert(appUsers)
    .values({
      id: DEMO_ADMIN_ID,
      orgId: DEMO_ORG_ID,
      email: DEMO_ADMIN_EMAIL,
      fullName: "Demo Admin",
      role: "admin",
    })
    .onConflictDoNothing({ target: appUsers.id });

  const rows = DEFAULT_CHART_OF_ACCOUNTS.map((a) => ({
    orgId: DEMO_ORG_ID,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype ?? null,
    description: a.description ?? null,
    normalBalance: a.normalBalance,
  }));

  await db
    .insert(accounts)
    .values(rows)
    .onConflictDoNothing({ target: [accounts.orgId, accounts.name] });

  // Resolve the parent hierarchy by name (parents are referenced by name).
  const existing = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.orgId, DEMO_ORG_ID));
  const idByName = new Map(existing.map((r) => [r.name, r.id]));

  let linked = 0;
  for (const a of DEFAULT_CHART_OF_ACCOUNTS) {
    if (!a.parentName) continue;
    const parentId = idByName.get(a.parentName);
    if (!parentId) continue;
    await db
      .update(accounts)
      .set({ parentId })
      .where(and(eq(accounts.orgId, DEMO_ORG_ID), eq(accounts.name, a.name)));
    linked++;
  }

  console.log(
    `Seeded org ${DEMO_ORG_ID} with ${rows.length} accounts (${linked} parent links) and admin ${DEMO_ADMIN_EMAIL}.`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
