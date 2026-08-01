/**
 * Workspace-reset guard integration tests (M0.1) — real Postgres, real auth and
 * admin middleware, RLS-bound as `sentire_books_app`.
 *
 * Skipped unless DATABASE_URL is set.
 *
 * These drive the actual `dataAdminRoutes` router (not a stub) so the auth →
 * admin-role → guard → confirmation chain is exercised end to end.
 *
 * Deliberately NOT covered here: the fully destructive success path. Reset wipes
 * every row in the caller's workspace, and these tests share the seeded demo org
 * with the other integration suites. Instead we prove the guard *opens* by
 * asserting the request gets past the 403 and is rejected by the confirmation
 * check — the boundary M0.1 actually changes — and assert the workspace's data
 * is still intact afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import {
  withOrgContext,
  accounts,
  DEMO_ORG_ID,
  DEMO_ADMIN_ID,
  DEMO_ADMIN_EMAIL,
} from "@sentire-books/db";
import { dataAdminRoutes } from "../routes/dataAdmin";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

const app = new Hono();
app.route("/settings/data", dataAdminRoutes);

/** Admin caller via the dev-bypass header path (no signing secret in tests). */
const post = (body: unknown) =>
  app.request("/settings/data/reset", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": DEMO_ADMIN_ID,
      "x-user-email": DEMO_ADMIN_EMAIL,
      "x-org-id": DEMO_ORG_ID,
    },
    body: JSON.stringify(body),
  });

const countAccounts = () =>
  withOrgContext(ctx, (tx) => tx.select().from(accounts)).then((r) => r.length);

describe.skipIf(!RUN)("POST /settings/data/reset — fail-closed guard", () => {
  const saved = {
    reset: process.env.ALLOW_WORKSPACE_RESET,
    secret: process.env.AUTH_JWT_SECRET,
    bypass: process.env.AUTH_DEV_BYPASS,
  };
  let orgCode = "";

  beforeAll(async () => {
    // Exercise the dev-bypass identity path: no signing secret in tests.
    delete process.env.AUTH_JWT_SECRET;
    process.env.AUTH_DEV_BYPASS = "true";
    const rows = (await withOrgContext(ctx, (tx) =>
      tx.execute(`SELECT code FROM organizations WHERE id = '${DEMO_ORG_ID}'`),
    )) as unknown as Array<{ code: string }>;
    orgCode = rows[0]!.code;
  });

  afterAll(() => {
    if (saved.reset === undefined) delete process.env.ALLOW_WORKSPACE_RESET;
    else process.env.ALLOW_WORKSPACE_RESET = saved.reset;
    if (saved.secret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = saved.secret;
    if (saved.bypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = saved.bypass;
  });

  it("is blocked when ALLOW_WORKSPACE_RESET is unset — even with the right code", async () => {
    delete process.env.ALLOW_WORKSPACE_RESET;
    const before = await countAccounts();

    const res = await post({ confirm: orgCode });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error?: string }).error).toBe("reset_disabled");
    expect(await countAccounts()).toBe(before); // nothing wiped
  });

  it.each(["", "false", "TRUE", "1", "yes"])(
    "is blocked when the switch reads %j",
    async (value) => {
      process.env.ALLOW_WORKSPACE_RESET = value;
      const res = await post({ confirm: orgCode });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error?: string }).error).toBe("reset_disabled");
    },
  );

  it("clears the guard when explicitly enabled, but still demands the workspace code", async () => {
    process.env.ALLOW_WORKSPACE_RESET = "true";
    const before = await countAccounts();

    const res = await post({ confirm: "RESET" }); // the old static token

    // 400 (not 403) proves the env guard opened and the confirmation check ran.
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; detail?: string };
    expect(body.error).toBe("confirmation_mismatch");
    expect(body.detail).toContain(orgCode);
    expect(await countAccounts()).toBe(before); // still nothing wiped
  });

  it("rejects another workspace's code", async () => {
    process.env.ALLOW_WORKSPACE_RESET = "true";
    const res = await post({ confirm: `${orgCode}-WRONG` });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe("confirmation_mismatch");
  });

  it("rejects a missing confirmation outright", async () => {
    process.env.ALLOW_WORKSPACE_RESET = "true";
    const res = await post({});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error?: string }).error).toBe("validation_error");
  });
});
