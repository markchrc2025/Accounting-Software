import { Hono } from "hono";
import { ZodError } from "zod";
import { and, asc, desc, eq } from "drizzle-orm";
import { UnbalancedEntryError } from "@scalebooks/domain";
import { withOrgContext, journalEntries, journalLines } from "@scalebooks/db";
import { requireAuth, canPost } from "../auth";
import { postJournalEntry, reverseJournalEntry } from "../ledger/postJournalEntry";

export const journalRoutes = new Hono();

journalRoutes.use("*", requireAuth);

// List recent journal entries for the caller's org.
journalRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const rows = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.orgId, auth.orgId))
        .orderBy(desc(journalEntries.createdAt))
        .limit(100),
  );
  return c.json({ entries: rows });
});

// One entry with its lines.
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
      const lines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, id))
        .orderBy(asc(journalLines.lineNo));
      return { entry, lines };
    },
  );
  if (!result) return c.json({ error: "not_found" }, 404);
  return c.json(result);
});

journalRoutes.post("/", async (c) => {
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

journalRoutes.post("/:id/reverse", async (c) => {
  const auth = c.get("auth");
  if (!canPost(auth.role)) {
    return c.json({ error: "forbidden", detail: "Poster role required" }, 403);
  }
  try {
    const result = await reverseJournalEntry(c.req.param("id"), {
      userId: auth.userId,
      orgId: auth.orgId,
    });
    return c.json(result, 201);
  } catch (err) {
    console.error("[reverseJournalEntry]", err);
    return c.json({ error: "internal_error", detail: (err as Error).message }, 400);
  }
});
