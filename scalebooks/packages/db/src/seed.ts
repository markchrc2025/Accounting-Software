/**
 * Seed a demo organization, an admin user, and the standard chart of accounts.
 * Idempotent: fixed IDs + ON CONFLICT DO NOTHING, so it is safe to re-run.
 *
 *   pnpm --filter @scalebooks/db seed
 */
import { DEFAULT_CHART_OF_ACCOUNTS, normalBalanceFor } from "@scalebooks/domain";
import { db } from "./index";
import { organizations, appUsers, accounts } from "./schema";
import { DEMO_ORG_ID, DEMO_ADMIN_ID, DEMO_ADMIN_EMAIL } from "./demo";

async function seed() {
  console.log("Seeding demo organization…");

  await db
    .insert(organizations)
    .values({ id: DEMO_ORG_ID, name: "Demo Company Inc." })
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
    normalBalance: normalBalanceFor(a.type),
  }));

  await db
    .insert(accounts)
    .values(rows)
    .onConflictDoNothing({ target: [accounts.orgId, accounts.name] });

  console.log(
    `Seeded org ${DEMO_ORG_ID} with ${rows.length} accounts and admin ${DEMO_ADMIN_EMAIL}.`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
