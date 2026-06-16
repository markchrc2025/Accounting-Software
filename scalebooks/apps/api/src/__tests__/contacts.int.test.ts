/**
 * Contacts integration tests — persistence + RLS isolation against real Postgres.
 * Skipped unless DATABASE_URL is set (CI provides it).
 */
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { withOrgContext, contacts, DEMO_ORG_ID, DEMO_ADMIN_ID } from "@scalebooks/db";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

describe.skipIf(!RUN)("contacts integration (Postgres)", () => {
  it("creates and lists a contact within the org", async () => {
    const name = `Vendor ${Date.now()}`;
    const created = await withOrgContext(ctx, async (tx) => {
      const [row] = await tx
        .insert(contacts)
        .values({ orgId: DEMO_ORG_ID, type: "vendor", name })
        .returning();
      return row;
    });
    expect(created?.id).toBeTruthy();

    const rows = await withOrgContext(ctx, (tx) =>
      tx.select().from(contacts).where(eq(contacts.id, created!.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe(name);
  });

  it("RLS hides contacts from other organizations", async () => {
    const otherOrg = "00000000-0000-0000-0000-0000000000ff";
    const rows = await withOrgContext({ userId: DEMO_ADMIN_ID, orgId: otherOrg }, (tx) =>
      tx.select().from(contacts),
    );
    expect(rows).toHaveLength(0);
  });
});
