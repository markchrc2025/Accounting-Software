import { Hono } from "hono";
import { ZodError } from "zod";
import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import {
  UnbalancedEntryError,
  zVoucherUpdate,
  zVoucherStatusTransition,
  voucherTotal,
  VOUCHER_TRANSITIONS,
  VOUCHER_EDITABLE_STATUSES,
  VOUCHER_DELETABLE_STATUSES,
  VOUCHER_STATUSES,
  VOUCHER_TYPES,
  type VoucherStatus,
  type VoucherType,
} from "@scalebooks/domain";
import { withOrgContext, vouchers, voucherLines, contacts, accounts, appUsers } from "@scalebooks/db";
import { requireAuth, canPost } from "../auth";
import { createVoucher } from "../ledger/createVoucher";
import {
  createVoucherDraft,
  approveVoucherCore,
  voidVoucher,
  VoucherNotFoundError,
  MissingCashAccountError,
} from "../ledger/voucherWorkflow";

export const voucherRoutes = new Hono();

voucherRoutes.use("*", requireAuth);

const POSTERS = ["poster", "approver", "admin"] as const;
const VERIFIERS = ["verifier", "poster", "approver", "admin"] as const;
const isPoster = (r: string) => (POSTERS as readonly string[]).includes(r);
const isVerifier = (r: string) => (VERIFIERS as readonly string[]).includes(r);

// List vouchers: ?type=&status=&q=&limit=&offset= with contact + cash-account
// names, purpose, notes, journalEntryId, and the creator's email.
voucherRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 500);
  const offset = Math.max(Number(q.offset) || 0, 0);

  const where = [eq(vouchers.orgId, auth.orgId)];
  if (q.type && (VOUCHER_TYPES as readonly string[]).includes(q.type)) {
    where.push(eq(vouchers.voucherType, q.type as VoucherType));
  }
  if (q.status && (VOUCHER_STATUSES as readonly string[]).includes(q.status)) {
    where.push(eq(vouchers.status, q.status as VoucherStatus));
  }
  if (q.q) {
    const needle = `%${q.q}%`;
    where.push(
      or(
        ilike(vouchers.voucherNo, needle),
        ilike(vouchers.memo, needle),
        ilike(vouchers.purposeCategory, needle),
      )!,
    );
  }

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
          notes: vouchers.notes,
          purposeCategory: vouchers.purposeCategory,
          status: vouchers.status,
          totalCents: vouchers.totalCents,
          journalEntryId: vouchers.journalEntryId,
          contactId: vouchers.contactId,
          contactName: contacts.name,
          paymentFromAccountId: vouchers.paymentFromAccountId,
          paymentFromAccountCode: accounts.code,
          paymentFromAccountName: accounts.name,
          meta: vouchers.meta,
          createdAt: vouchers.createdAt,
          createdByEmail: appUsers.email,
        })
        .from(vouchers)
        .leftJoin(contacts, eq(contacts.id, vouchers.contactId))
        .leftJoin(accounts, eq(accounts.id, vouchers.paymentFromAccountId))
        .leftJoin(appUsers, eq(appUsers.id, vouchers.createdBy))
        .where(and(...where))
        .orderBy(desc(vouchers.voucherDate), desc(vouchers.createdAt))
        .limit(limit)
        .offset(offset),
  );
  return c.json({ vouchers: rows });
});

// One voucher with its persisted lines (account code/name joined).
voucherRoutes.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const result = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    async (tx) => {
      const [voucher] = await tx
        .select()
        .from(vouchers)
        .where(and(eq(vouchers.id, id), eq(vouchers.orgId, auth.orgId)));
      if (!voucher) return null;
      const lines = await tx
        .select({
          lineNo: voucherLines.lineNo,
          accountId: voucherLines.accountId,
          accountCode: accounts.code,
          accountName: accounts.name,
          description: voucherLines.description,
          amountCents: voucherLines.amountCents,
          meta: voucherLines.meta,
        })
        .from(voucherLines)
        .innerJoin(accounts, eq(accounts.id, voucherLines.accountId))
        .where(eq(voucherLines.voucherId, id))
        .orderBy(asc(voucherLines.lineNo));
      return { voucher, lines };
    },
  );
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json(result);
});

// Create. draft:true → workflow document (any member, no JE yet). Otherwise the
// legacy atomic create-and-post path (requires a posting role) stays untouched.
voucherRoutes.post("/", async (c) => {
  const auth = c.get("auth");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const isDraft = typeof body === "object" && body !== null && (body as { draft?: boolean }).draft === true;

  try {
    if (isDraft) {
      const result = await createVoucherDraft(body, { userId: auth.userId, orgId: auth.orgId });
      return c.json(result, 201);
    }
    if (!canPost(auth.role)) {
      return c.json({ error: "forbidden", detail: "Poster role required" }, 403);
    }
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

// Edit a draft/pending/rejected voucher; `lines`, when given, replaces all lines.
voucherRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const input = zVoucherUpdate.parse(body);
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [voucher] = await tx
          .select({ id: vouchers.id, status: vouchers.status })
          .from(vouchers)
          .where(and(eq(vouchers.id, id), eq(vouchers.orgId, auth.orgId)));
        if (!voucher) return { error: 404 as const };
        if (!VOUCHER_EDITABLE_STATUSES.includes(voucher.status)) return { error: 409 as const };

        const set: Record<string, unknown> = {};
        if (input.type !== undefined) set.voucherType = input.type;
        if (input.contactId !== undefined) set.contactId = input.contactId;
        if (input.voucherDate !== undefined) set.voucherDate = input.voucherDate;
        if (input.memo !== undefined) set.memo = input.memo;
        if (input.notes !== undefined) set.notes = input.notes;
        if (input.purposeCategory !== undefined) set.purposeCategory = input.purposeCategory;
        if (input.paymentFromAccountId !== undefined) set.paymentFromAccountId = input.paymentFromAccountId;
        if (input.meta !== undefined) set.meta = input.meta;
        if (input.lines) {
          set.totalCents = voucherTotal(input.lines);
          await tx.delete(voucherLines).where(eq(voucherLines.voucherId, id));
          await tx.insert(voucherLines).values(
            input.lines.map((l, i) => ({
              voucherId: id,
              lineNo: i + 1,
              accountId: l.accountId,
              description: l.description ?? null,
              amountCents: l.amountCents,
              meta: l.meta ?? null,
            })),
          );
        }
        if (Object.keys(set).length > 0) {
          await tx.update(vouchers).set(set).where(eq(vouchers.id, id));
        }
        const [updated] = await tx.select().from(vouchers).where(eq(vouchers.id, id));
        return { voucher: updated };
      },
    );
    if ("error" in outcome) {
      return outcome.error === 404
        ? c.json({ error: "not_found" }, 404)
        : c.json({ error: "not_editable", detail: "Only draft, pending, or rejected vouchers can be edited." }, 409);
    }
    return c.json({ voucher: outcome.voucher });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    console.error("[updateVoucher]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Delete a draft/rejected voucher (lines cascade).
voucherRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  try {
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [voucher] = await tx
          .select({ id: vouchers.id, status: vouchers.status })
          .from(vouchers)
          .where(and(eq(vouchers.id, id), eq(vouchers.orgId, auth.orgId)));
        if (!voucher) return { error: 404 as const };
        if (!VOUCHER_DELETABLE_STATUSES.includes(voucher.status)) return { error: 409 as const };
        await tx.delete(vouchers).where(eq(vouchers.id, id));
        return { ok: true as const };
      },
    );
    if ("error" in outcome) {
      return outcome.error === 404
        ? c.json({ error: "not_found" }, 404)
        : c.json({ error: "not_deletable", detail: "Only draft or rejected vouchers can be deleted. Void it instead." }, 409);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error("[deleteVoucher]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Workflow transition. 'approved' is the ledger event: it posts the JE from the
// voucher's stored lines (requires the payment-from account to be set).
voucherRoutes.post("/:id/status", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const { to } = zVoucherStatusTransition.parse(body);
    if ((to === "verified" || to === "rejected") && !isVerifier(auth.role)) {
      return c.json({ error: "forbidden", detail: "Verification requires a verifier role" }, 403);
    }
    if ((to === "approved" || to === "paid") && !isPoster(auth.role)) {
      return c.json({ error: "forbidden", detail: "Approval requires a poster or approver role" }, 403);
    }

    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [voucher] = await tx
          .select()
          .from(vouchers)
          .where(and(eq(vouchers.id, id), eq(vouchers.orgId, auth.orgId)));
        if (!voucher) return { error: 404 as const };
        const allowed = VOUCHER_TRANSITIONS[voucher.status] ?? [];
        if (!allowed.includes(to)) return { error: 409 as const, from: voucher.status };

        let journalEntryNo: string | undefined;
        if (to === "approved") {
          const je = await approveVoucherCore(tx, id, { userId: auth.userId, orgId: auth.orgId });
          journalEntryNo = je.entryNo;
        }
        const [updated] = await tx
          .update(vouchers)
          .set({ status: to })
          .where(eq(vouchers.id, id))
          .returning();
        return { voucher: updated, journalEntryNo };
      },
    );
    if ("error" in outcome) {
      if (outcome.error === 404) return c.json({ error: "not_found" }, 404);
      return c.json(
        { error: "invalid_transition", detail: `Cannot move from '${outcome.from}' to '${to}'` },
        409,
      );
    }
    return c.json({ voucher: outcome.voucher, journalEntryNo: outcome.journalEntryNo });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    if (err instanceof MissingCashAccountError) {
      return c.json({ error: "missing_cash_account", detail: err.message }, 422);
    }
    if (err instanceof UnbalancedEntryError) {
      return c.json({ error: "unbalanced", debit: err.debit, credit: err.credit }, 422);
    }
    console.error("[transitionVoucher]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Void: reverses the linked JE (when posted) and marks the voucher void.
voucherRoutes.post("/:id/void", async (c) => {
  const auth = c.get("auth");
  if (!isPoster(auth.role)) {
    return c.json({ error: "forbidden", detail: "Voiding requires a poster or approver role" }, 403);
  }
  try {
    const result = await voidVoucher(c.req.param("id"), { userId: auth.userId, orgId: auth.orgId });
    return c.json(result);
  } catch (err) {
    if (err instanceof VoucherNotFoundError) return c.json({ error: "not_found" }, 404);
    console.error("[voidVoucher]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
