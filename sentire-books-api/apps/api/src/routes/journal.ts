import { Hono } from "hono";
import { ZodError } from "zod";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import {
  UnbalancedEntryError,
  zJournalEntryUpdate,
  zJournalStatusTransition,
  JOURNAL_TRANSITIONS,
  EDITABLE_STATUSES,
  DELETABLE_STATUSES,
  ENTRY_STATUSES,
  ENTRY_TYPES,
  isBalanced,
  type EntryStatus,
} from "@sentire-books/domain";
import {
  withOrgContext,
  journalEntries,
  journalLines,
  accounts,
  contacts,
  appUsers,
} from "@sentire-books/db";
import { requireAuth, canPost } from "../auth";
import {
  postJournalEntry,
  reverseJournalEntry,
  EntryNotFoundError,
  EntryNotPostedError,
} from "../ledger/postJournalEntry";

export const journalRoutes = new Hono();

journalRoutes.use("*", requireAuth);

/** Roles allowed to move entries through clearing/posting. */
const WORKFLOW_POSTERS = ["poster", "approver", "admin"] as const;
const canWorkflowPost = (role: string) =>
  (WORKFLOW_POSTERS as readonly string[]).includes(role);

const isCheckViolation = (err: unknown): boolean =>
  !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23514";

/** Enriched lines (account code/name + contact name) for a set of entries. */
async function linesFor(tx: Parameters<Parameters<typeof withOrgContext>[1]>[0], entryIds: string[]) {
  if (entryIds.length === 0) return new Map<string, unknown[]>();
  const rows = await tx
    .select({
      entryId: journalLines.entryId,
      lineNo: journalLines.lineNo,
      accountId: journalLines.accountId,
      accountCode: accounts.code,
      accountName: accounts.name,
      contactId: journalLines.contactId,
      contactName: contacts.name,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
      description: journalLines.description,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .leftJoin(contacts, eq(contacts.id, journalLines.contactId))
    .where(inArray(journalLines.entryId, entryIds))
    .orderBy(asc(journalLines.entryId), asc(journalLines.lineNo));
  const byEntry = new Map<string, unknown[]>();
  for (const r of rows) {
    const list = byEntry.get(r.entryId) ?? [];
    list.push(r);
    byEntry.set(r.entryId, list);
  }
  return byEntry;
}

// List entries: ?status=&type=&from=&to=&q=&limit=&offset=. Lines come embedded
// (with account code/name + contact name), plus totalCents and createdByEmail.
journalRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const q = c.req.query();
  const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
  const offset = Math.max(Number(q.offset) || 0, 0);

  const where = [eq(journalEntries.orgId, auth.orgId)];
  if (q.status && (ENTRY_STATUSES as readonly string[]).includes(q.status)) {
    where.push(eq(journalEntries.status, q.status as EntryStatus));
  }
  if (q.type && (ENTRY_TYPES as readonly string[]).includes(q.type)) {
    where.push(eq(journalEntries.entryType, q.type));
  }
  if (q.from) where.push(gte(journalEntries.entryDate, q.from));
  if (q.to) where.push(lte(journalEntries.entryDate, q.to));
  if (q.q) {
    const needle = `%${q.q}%`;
    where.push(
      or(
        ilike(journalEntries.entryNo, needle),
        ilike(journalEntries.memo, needle),
        ilike(journalEntries.reference, needle),
      )!,
    );
  }

  const result = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    async (tx) => {
      const entries = await tx
        .select({
          id: journalEntries.id,
          entryNo: journalEntries.entryNo,
          entryDate: journalEntries.entryDate,
          memo: journalEntries.memo,
          status: journalEntries.status,
          entryType: journalEntries.entryType,
          reference: journalEntries.reference,
          accrualReversalOf: journalEntries.accrualReversalOf,
          reversalOf: journalEntries.reversalOf,
          sourceType: journalEntries.sourceType,
          createdAt: journalEntries.createdAt,
          postedAt: journalEntries.postedAt,
          createdByEmail: appUsers.email,
          totalCents: sql<number>`(
            SELECT COALESCE(SUM(jl.debit_cents), 0)::bigint
            FROM journal_lines jl WHERE jl.entry_id = ${journalEntries.id}
          )`,
        })
        .from(journalEntries)
        .leftJoin(appUsers, eq(appUsers.id, journalEntries.createdBy))
        .where(and(...where))
        .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
        .limit(limit)
        .offset(offset);

      const byEntry = await linesFor(tx, entries.map((e) => e.id));
      return entries.map((e) => ({
        ...e,
        totalCents: Number(e.totalCents),
        lines: byEntry.get(e.id) ?? [],
      }));
    },
  );
  return c.json({ entries: result });
});

// One entry with enriched lines.
journalRoutes.get("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  const result = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    async (tx) => {
      const [entry] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.id, id), eq(journalEntries.orgId, auth.orgId)));
      if (!entry) return null;
      const byEntry = await linesFor(tx, [id]);
      return { entry, lines: byEntry.get(id) ?? [] };
    },
  );
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json(result);
});

// Create. post=true (default) writes to the ledger and needs a posting role;
// post=false saves a workflow draft any member may create. Accrual entries
// auto-create their future-dated reversing draft.
journalRoutes.post("/", async (c) => {
  const auth = c.get("auth");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const wantsPost = !(typeof body === "object" && body && (body as { post?: boolean }).post === false);
  if (wantsPost && !canPost(auth.role)) {
    return c.json({ error: "forbidden", detail: "Poster role required to post directly" }, 403);
  }

  try {
    // orgId always comes from the authenticated caller, never the client payload.
    const payload = { ...(typeof body === "object" && body ? body : {}), orgId: auth.orgId };
    const result = await postJournalEntry(payload, { userId: auth.userId, orgId: auth.orgId });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    if (err instanceof UnbalancedEntryError) {
      return c.json({ error: "unbalanced", debit: err.debit, credit: err.credit }, 422);
    }
    console.error("[postJournalEntry]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Edit a not-yet-posted entry: header fields, and (when given) replace all lines.
journalRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const input = zJournalEntryUpdate.parse(body);
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [entry] = await tx
          .select({ id: journalEntries.id, status: journalEntries.status })
          .from(journalEntries)
          .where(and(eq(journalEntries.id, id), eq(journalEntries.orgId, auth.orgId)));
        if (!entry) return { error: 404 as const };
        if (!EDITABLE_STATUSES.includes(entry.status)) return { error: 409 as const };

        const set: Record<string, unknown> = {};
        if (input.entryDate !== undefined) set.entryDate = input.entryDate;
        if (input.memo !== undefined) set.memo = input.memo;
        if (input.entryType !== undefined) set.entryType = input.entryType;
        if (input.reference !== undefined) set.reference = input.reference;
        if (Object.keys(set).length > 0) {
          await tx.update(journalEntries).set(set).where(eq(journalEntries.id, id));
        }
        if (input.lines) {
          await tx.delete(journalLines).where(eq(journalLines.entryId, id));
          await tx.insert(journalLines).values(
            input.lines.map((l, i) => ({
              entryId: id,
              lineNo: i + 1,
              accountId: l.accountId,
              debitCents: l.debitCents,
              creditCents: l.creditCents,
              contactId: l.contactId ?? null,
              description: l.description ?? null,
            })),
          );
        }
        const [updated] = await tx
          .select()
          .from(journalEntries)
          .where(eq(journalEntries.id, id));
        return { entry: updated };
      },
    );
    if ("error" in outcome) {
      return outcome.error === 404
        ? c.json({ error: "not_found" }, 404)
        : c.json({ error: "not_editable", detail: "Posted or reversed entries are immutable — create a reversing entry instead." }, 409);
    }
    return c.json({ entry: outcome.entry });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    console.error("[updateJournalEntry]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Delete a draft/rejected entry (posted entries are trigger-protected anyway).
journalRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");
  try {
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [entry] = await tx
          .select({ id: journalEntries.id, status: journalEntries.status })
          .from(journalEntries)
          .where(and(eq(journalEntries.id, id), eq(journalEntries.orgId, auth.orgId)));
        if (!entry) return { error: 404 as const };
        if (!DELETABLE_STATUSES.includes(entry.status)) return { error: 409 as const };
        await tx.delete(journalLines).where(eq(journalLines.entryId, id));
        await tx.delete(journalEntries).where(eq(journalEntries.id, id));
        return { ok: true as const };
      },
    );
    if ("error" in outcome) {
      return outcome.error === 404
        ? c.json({ error: "not_found" }, 404)
        : c.json({ error: "not_deletable", detail: "Only draft or rejected entries can be deleted." }, 409);
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error("[deleteJournalEntry]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Workflow transition. Moving to 'posted' is the ledger event: it requires a
// posting role, stamps postedAt, and the DB's deferred trigger re-verifies the
// balance at commit.
journalRoutes.post("/:id/status", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const { to } = zJournalStatusTransition.parse(body);
    if (to === "posted" && !canWorkflowPost(auth.role)) {
      return c.json({ error: "forbidden", detail: "Posting requires a poster or approver role" }, 403);
    }
    if ((to === "cleared" || to === "for_posting") && !canWorkflowPost(auth.role)) {
      return c.json({ error: "forbidden", detail: "Clearing requires a poster or approver role" }, 403);
    }

    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [entry] = await tx
          .select()
          .from(journalEntries)
          .where(and(eq(journalEntries.id, id), eq(journalEntries.orgId, auth.orgId)));
        if (!entry) return { error: 404 as const };
        const allowed = JOURNAL_TRANSITIONS[entry.status] ?? [];
        if (!allowed.includes(to)) return { error: 409 as const, from: entry.status };
        if (to === "posted") {
          const lines = await tx
            .select({ debitCents: journalLines.debitCents, creditCents: journalLines.creditCents })
            .from(journalLines)
            .where(eq(journalLines.entryId, id));
          if (!isBalanced(lines)) return { error: 422 as const };
        }
        const [updated] = await tx
          .update(journalEntries)
          .set(to === "posted" ? { status: to, postedAt: new Date() } : { status: to })
          .where(eq(journalEntries.id, id))
          .returning();
        return { entry: updated };
      },
    );
    if ("error" in outcome) {
      if (outcome.error === 404) return c.json({ error: "not_found" }, 404);
      if (outcome.error === 422) return c.json({ error: "unbalanced", detail: "Entry must balance before posting" }, 422);
      return c.json(
        { error: "invalid_transition", detail: `Cannot move from '${outcome.from}' to '${to}'` },
        409,
      );
    }
    return c.json({ entry: outcome.entry });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    if (isCheckViolation(err)) {
      return c.json({ error: "unbalanced", detail: "Entry must balance before posting" }, 422);
    }
    console.error("[transitionJournalEntry]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

journalRoutes.post("/:id/reverse", async (c) => {
  const auth = c.get("auth");
  if (!canWorkflowPost(auth.role)) {
    return c.json({ error: "forbidden", detail: "Poster role required" }, 403);
  }
  try {
    const result = await reverseJournalEntry(c.req.param("id"), {
      userId: auth.userId,
      orgId: auth.orgId,
    });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof EntryNotFoundError) {
      return c.json({ error: "not_found" }, 404);
    }
    if (err instanceof EntryNotPostedError) {
      return c.json({ error: "invalid_status", detail: err.message }, 409);
    }
    console.error("[reverseJournalEntry]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
