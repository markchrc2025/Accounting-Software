/**
 * Seed a demo organization, an admin user, and the standard chart of accounts.
 * Idempotent: fixed IDs + ON CONFLICT DO NOTHING, so it is safe to re-run.
 *
 *   pnpm --filter @scalebooks/db seed
 */
import { DEFAULT_CHART_OF_ACCOUNTS } from "@scalebooks/domain";
import { db } from "./index";
import { organizations, appUsers, accounts } from "./schema";

// Stable identifiers so re-running the seed never duplicates rows.
export const DEMO_ORG_ID = "00000000-0000-0000-0000-0000000000a1";
export const DEMO_ADMIN_ID = "00000000-0000-0000-0000-0000000000b1";
const DEMO_ADMIN_EMAIL = "admin@demo.scalebooks.local";

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
  }));

  await db
    .insert(accounts)
    .values(rows)
    .onConflictDoNothing({ target: [accounts.orgId, accounts.code] });

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
