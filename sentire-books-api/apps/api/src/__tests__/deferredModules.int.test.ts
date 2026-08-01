/**
 * Deferred-module sealing (M0.5) — real Postgres, real routers, RLS-bound as
 * `sentire_books_app`. Skipped unless DATABASE_URL is set.
 *
 * Loans and Fixed Assets are deferred for MVP: hidden in the portal, and locked
 * down here so the ledger-writing endpoints cannot be reached by an
 * unauthorized role or bypassed by a hard delete.
 *
 * Two properties under test:
 *  1. Every endpoint that posts or reverses a journal entry requires a
 *     poster/approver role — mirroring `POST /journal-entries/:id/status`.
 *     Before M0.5 these carried no role check at all, so any authenticated
 *     member could post real entries.
 *  2. The generic `DELETE /:id` is sealed, preserving "never deleted, only
 *     cancelled" — a hard delete would orphan the journal entry it posted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  withOrgContext,
  appUsers,
  loans,
  fixedAssets,
  assetTypes,
  DEMO_ORG_ID,
  DEMO_ADMIN_ID,
  DEMO_ADMIN_EMAIL,
  type UserRole,
} from "@sentire-books/db";
import { loanRoutes, fixedAssetRoutes, assetTypeRoutes } from "../routes/financial";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

const app = new Hono();
app.route("/loans", loanRoutes);
app.route("/fixed-assets", fixedAssetRoutes);
app.route("/asset-types", assetTypeRoutes);

const call = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": DEMO_ADMIN_ID,
      "x-user-email": DEMO_ADMIN_EMAIL,
      "x-org-id": DEMO_ORG_ID,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Flip the demo admin's role for the duration of one assertion. */
const setRole = (role: UserRole) =>
  withOrgContext(ctx, (tx) =>
    tx.update(appUsers).set({ role }).where(and(eq(appUsers.orgId, DEMO_ORG_ID), eq(appUsers.id, DEMO_ADMIN_ID))),
  );

/** Endpoints that post or reverse a journal entry. */
const LEDGER_ENDPOINTS: Array<[string, string, unknown]> = [
  ["POST", "/loans/register", { name: "Gated", principalCents: 1000 }],
  ["POST", "/loans/00000000-0000-0000-0000-0000000000ff/book", { mode: "disbursement" }],
  ["POST", "/loans/00000000-0000-0000-0000-0000000000ff/unbook", {}],
  ["POST", "/loans/00000000-0000-0000-0000-0000000000ff/cancel", {}],
  ["POST", "/loans/00000000-0000-0000-0000-0000000000ff/pay", { payDate: "2026-01-01", principalCents: 100 }],
  ["POST", "/fixed-assets/register", { assetNo: "GATED-1", name: "Gated", costCents: 1000 }],
  ["POST", "/fixed-assets/00000000-0000-0000-0000-0000000000ff/book", { mode: "cash" }],
  ["POST", "/fixed-assets/00000000-0000-0000-0000-0000000000ff/cancel", {}],
];

const UNAUTHORIZED: UserRole[] = ["maker", "verifier"];

describe.skipIf(!RUN)("M0.5 — deferred modules are sealed", () => {
  const saved = { secret: process.env.AUTH_JWT_SECRET, bypass: process.env.AUTH_DEV_BYPASS };

  beforeAll(async () => {
    // Exercise the dev-bypass identity path: no signing secret in tests.
    delete process.env.AUTH_JWT_SECRET;
    process.env.AUTH_DEV_BYPASS = "true";
    await setRole("admin"); // known starting point
  });

  afterAll(async () => {
    await setRole("admin"); // never leave the demo user demoted
    if (saved.secret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = saved.secret;
    if (saved.bypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = saved.bypass;
  });

  describe("ledger endpoints require a poster/approver role", () => {
    for (const role of UNAUTHORIZED) {
      it(`403s every booking endpoint for '${role}'`, async () => {
        await setRole(role);
        try {
          for (const [method, path, body] of LEDGER_ENDPOINTS) {
            const res = await call(method, path, body);
            expect(res.status, `${method} ${path} as ${role}`).toBe(403);
            expect(((await res.json()) as { error?: string }).error).toBe("forbidden");
          }
        } finally {
          await setRole("admin");
        }
      });
    }

    it("lets an authorized role through the gate (not a blanket 403)", async () => {
      await setRole("poster");
      try {
        // A poster clears the gate; this id doesn't exist, so the handler runs
        // and answers 404 — proving the request got past the role check.
        const res = await call("POST", "/loans/00000000-0000-0000-0000-0000000000ff/book", {
          mode: "disbursement",
        });
        expect(res.status).toBe(404);
      } finally {
        await setRole("admin");
      }
    });

    it("still allows admin", async () => {
      const res = await call("POST", "/fixed-assets/00000000-0000-0000-0000-0000000000ff/cancel", {});
      expect(res.status).toBe(404); // past the gate, record simply absent
    });
  });

  describe("generic DELETE is sealed (reverse-only)", () => {
    it.each([
      ["/loans", "loan"],
      ["/fixed-assets", "asset"],
    ])("405s DELETE on %s", async (base, singular) => {
      const res = await call("DELETE", `${base}/00000000-0000-0000-0000-0000000000ff`);
      expect(res.status).toBe(405);
      const body = (await res.json()) as { error?: string; detail?: string };
      expect(body.error).toBe("method_not_allowed");
      expect(body.detail).toContain(singular);
    });

    it("does not delete a real record", async () => {
      const suffix = `${Date.now()}`;
      const [row] = await withOrgContext(ctx, (tx) =>
        tx
          .insert(loans)
          .values({ orgId: DEMO_ORG_ID, loanNo: `LN-SEALED-${suffix}`, name: "Sealed", principalCents: 500 } as never)
          .returning(),
      );
      try {
        expect((await call("DELETE", `/loans/${row!.id}`)).status).toBe(405);
        const still = await withOrgContext(ctx, (tx) =>
          tx.select().from(loans).where(eq(loans.id, row!.id)),
        );
        expect(still).toHaveLength(1); // survived the delete attempt
      } finally {
        await withOrgContext(ctx, (tx) => tx.delete(loans).where(eq(loans.id, row!.id)));
      }
    });

    it("does not delete a real fixed asset either", async () => {
      const suffix = `${Date.now()}`;
      const [asset] = await withOrgContext(ctx, (tx) =>
        tx
          .insert(fixedAssets)
          .values({ orgId: DEMO_ORG_ID, assetNo: `FA-SEALED-${suffix}`, name: "Sealed", costCents: 500 } as never)
          .returning(),
      );
      try {
        expect((await call("DELETE", `/fixed-assets/${asset!.id}`)).status).toBe(405);
        const still = await withOrgContext(ctx, (tx) =>
          tx.select().from(fixedAssets).where(eq(fixedAssets.id, asset!.id)),
        );
        expect(still).toHaveLength(1);
      } finally {
        await withOrgContext(ctx, (tx) => tx.delete(fixedAssets).where(eq(fixedAssets.id, asset!.id)));
      }
    });

    it("keeps DELETE working on a router that is NOT sealed", async () => {
      // disableDelete must be opt-in, not global. Asset TYPES are reference
      // data that post no journal entry, so they stay deletable.
      const [type] = await withOrgContext(ctx, (tx) =>
        tx
          .insert(assetTypes)
          .values({ orgId: DEMO_ORG_ID, typeNo: `FAT-${Date.now()}`, name: "Deletable" } as never)
          .returning(),
      );
      const res = await call("DELETE", `/asset-types/${type!.id}`);
      expect(res.status).toBe(200);
      const gone = await withOrgContext(ctx, (tx) =>
        tx.select().from(assetTypes).where(eq(assetTypes.id, type!.id)),
      );
      expect(gone).toHaveLength(0);
    });
  });
});
