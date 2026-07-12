import { Hono } from "hono";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import { zOrgSettingsUpdate } from "@scalebooks/domain";
import { withOrgContext, orgSettings } from "@scalebooks/db";
import { requireAuth } from "../auth";

export const settingsRoutes = new Hono();

settingsRoutes.use("*", requireAuth);

// Org settings: company profile (name/logo/notedBy), approval routing, doc
// numbering. Read by any member (PDF headers, signatories); written by admins.
settingsRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const [row] = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) => tx.select().from(orgSettings).where(eq(orgSettings.orgId, auth.orgId)),
  );
  return c.json({
    profile: row?.profile ?? null,
    approvalRouting: row?.approvalRouting ?? null,
    docNumbering: row?.docNumbering ?? null,
  });
});

settingsRoutes.put("/", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
    return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const input = zOrgSettingsUpdate.parse(body);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.profile !== undefined) set.profile = input.profile;
    if (input.approvalRouting !== undefined) set.approvalRouting = input.approvalRouting;
    if (input.docNumbering !== undefined) set.docNumbering = input.docNumbering;

    const [row] = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) =>
        tx
          .insert(orgSettings)
          .values({ orgId: auth.orgId, ...set })
          .onConflictDoUpdate({ target: orgSettings.orgId, set })
          .returning(),
    );
    return c.json({
      profile: row?.profile ?? null,
      approvalRouting: row?.approvalRouting ?? null,
      docNumbering: row?.docNumbering ?? null,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    console.error("[updateSettings]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
