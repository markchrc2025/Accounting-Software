import { Hono } from "hono";
import { ZodError } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { zOrgSettingsUpdate } from "@scalebooks/domain";
import { withOrgContext, orgSettings, documentCounters } from "@scalebooks/db";
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
    modulePolicies: row?.modulePolicies ?? null,
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
    if (input.modulePolicies !== undefined) set.modulePolicies = input.modulePolicies;

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
      modulePolicies: row?.modulePolicies ?? null,
    });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    console.error("[updateSettings]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// ── Document counters (admin) ─────────────────────────────────────────────────
// The Settings screen shows each period's last-issued sequence and lets an
// admin override it (e.g. after importing legacy documents). Numbering itself
// happens atomically in the create endpoints; these are inspection/override.
settingsRoutes.get("/counters", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
    return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
  }
  const rows = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select()
        .from(documentCounters)
        .where(eq(documentCounters.orgId, auth.orgId))
        .orderBy(asc(documentCounters.periodKey)),
  );
  return c.json({ counters: rows });
});

const zCounterOverride = z.object({ seq: z.number().int().min(0) });
settingsRoutes.put("/counters/:periodKey", async (c) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
    return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
  }
  const periodKey = c.req.param("periodKey");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const { seq } = zCounterOverride.parse(body);
    const rows = (await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) =>
        tx.execute(sql`
          INSERT INTO document_counters (org_id, period_key, seq)
          VALUES (${auth.orgId}, ${periodKey}, ${seq})
          ON CONFLICT (org_id, period_key)
          DO UPDATE SET seq = ${seq}
          RETURNING period_key, seq
        `),
    )) as unknown as Array<{ period_key: string; seq: number }>;
    return c.json({ counter: { periodKey: rows[0]!.period_key, seq: Number(rows[0]!.seq) } });
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[counterOverride]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
