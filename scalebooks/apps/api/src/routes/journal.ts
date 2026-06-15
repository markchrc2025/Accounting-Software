import { Hono } from "hono";
import { ZodError } from "zod";
import { UnbalancedEntryError } from "@scalebooks/domain";
import { requireAuth, canPost } from "../auth";
import { postJournalEntry, reverseJournalEntry } from "../ledger/postJournalEntry";

export const journalRoutes = new Hono();

journalRoutes.use("*", requireAuth);

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
    const result = await postJournalEntry(body, { userId: auth.userId, orgId: auth.orgId });
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
