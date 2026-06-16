import { Hono } from "hono";
import { ZodError } from "zod";
import { desc, eq } from "drizzle-orm";
import { UnbalancedEntryError } from "@scalebooks/domain";
import { withOrgContext, vouchers, contacts } from "@scalebooks/db";
import { requireAuth, canPost } from "../auth";
import { createVoucher } from "../ledger/createVoucher";

export const voucherRoutes = new Hono();

voucherRoutes.use("*", requireAuth);

// List recent vouchers with the contact name.
voucherRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const rows = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select({
          id: vouchers.id,
          voucherNo: vouchers.voucherNo,
          voucherType: vouchers.voucherType,
          voucherDate: vouchers.voucherDate,
          memo: vouchers.memo,
          status: vouchers.status,
          totalCents: vouchers.totalCents,
          contactName: contacts.name,
        })
        .from(vouchers)
        .leftJoin(contacts, eq(contacts.id, vouchers.contactId))
        .where(eq(vouchers.orgId, auth.orgId))
        .orderBy(desc(vouchers.createdAt))
        .limit(100),
  );
  return c.json({ vouchers: rows });
});

// Create a voucher (atomically posts its journal entry).
voucherRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  if (!canPost(auth.role)) {
    return c.json({ error: "forbidden", detail: "Poster role required" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const result = await createVoucher(body, { userId: auth.userId, orgId: auth.orgId });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    if (err instanceof UnbalancedEntryError) {
      return c.json({ error: "unbalanced", debit: err.debit, credit: err.credit }, 422);
    }
    console.error("[createVoucher]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
