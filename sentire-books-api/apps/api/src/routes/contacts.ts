import { Hono } from "hono";
import { ZodError } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  zContactInput,
  zContactUpdate,
  canonicalContactType,
  CONTACT_TYPES,
  type ContactType,
  type ContactInput,
  type ContactUpdate,
} from "@sentire-books/domain";
import { withOrgContext, contacts, type Tx } from "@sentire-books/db";
import { requireAuth } from "../auth";

export const contactRoutes = new Hono();

contactRoutes.use("*", requireAuth);

/** Atomic human-readable number: CNT{YYYYMM}-{NNNN} (server-owned counter). */
async function nextContactNo(tx: Tx, orgId: string): Promise<string> {
  const now = new Date();
  const periodKey = `CNT${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const counter = (await tx.execute(sql`
    INSERT INTO document_counters (org_id, period_key, seq)
    VALUES (${orgId}, ${periodKey}, 1)
    ON CONFLICT (org_id, period_key)
    DO UPDATE SET seq = document_counters.seq + 1
    RETURNING seq
  `)) as unknown as Array<{ seq: number }>;
  return `${periodKey}-${String(counter[0]!.seq).padStart(4, "0")}`;
}

/** Map validated input onto the contacts columns (shared by create/update). */
function toColumns(input: ContactInput | ContactUpdate) {
  const set: Record<string, unknown> = {};
  const copy = (from: keyof (ContactInput & ContactUpdate), to?: string) => {
    const v = (input as Record<string, unknown>)[from];
    if (v !== undefined) set[to ?? from] = v;
  };
  copy("name");
  copy("tin");
  copy("phone");
  copy("address");
  copy("isActive");
  copy("displayName");
  copy("parentId");
  copy("types");
  copy("costCenter");
  copy("category");
  copy("branch");
  copy("department");
  copy("arAccountCode");
  copy("apAccountCode");
  copy("paymentTerms");
  copy("currency");
  copy("creditLimitCents");
  copy("openingBalanceCents");
  copy("taxRef");
  copy("mobile");
  copy("website");
  copy("billingAddress");
  copy("shippingAddress");
  copy("banks");
  copy("contactPersons");
  copy("notes");
  copy("internalRemarks");
  copy("needsCompletion");
  if (input.email !== undefined) set.email = input.email || null;
  // Canonical enum: explicit type wins; otherwise derive from the rich labels.
  if (input.type !== undefined) set.type = input.type;
  else if (input.types && input.types.length > 0) set.type = canonicalContactType(input.types);
  return set;
}

const isFkViolation = (err: unknown): boolean =>
  !!err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23503";

// List contacts, optionally filtered by ?type=vendor|customer|employee.
contactRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const typeParam = c.req.query("type");
  const type = (CONTACT_TYPES as readonly string[]).includes(typeParam ?? "")
    ? (typeParam as ContactType)
    : undefined;

  const rows = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    (tx) =>
      tx
        .select()
        .from(contacts)
        .where(
          type
            ? and(eq(contacts.orgId, auth.orgId), eq(contacts.type, type))
            : eq(contacts.orgId, auth.orgId),
        )
        .orderBy(asc(contacts.name)),
  );
  return c.json({ contacts: rows });
});

// Create a contact. contact_no is assigned server-side when not supplied.
contactRoutes.post("/", async (c) => {
  const auth = c.get("auth");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const input = zContactInput.parse(body);
    const created = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const contactNo = await nextContactNo(tx, auth.orgId);
        const [row] = await tx
          .insert(contacts)
          .values({
            orgId: auth.orgId,
            contactNo,
            ...(toColumns(input) as { type: ContactType; name: string }),
          })
          .returning();
        return row;
      },
    );
    return c.json({ contact: created }, 201);
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    if (isFkViolation(err)) {
      return c.json({ error: "invalid_parent", detail: "Parent contact does not exist" }, 400);
    }
    console.error("[createContact]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Update a contact (partial: omitted fields are left unchanged).
contactRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  try {
    const input = zContactUpdate.parse(body);
    if (input.parentId && input.parentId === id) {
      return c.json({ error: "invalid_parent", detail: "A contact cannot be its own parent" }, 400);
    }
    const set = toColumns(input);
    if (Object.keys(set).length === 0) {
      return c.json({ error: "no_fields", detail: "Nothing to update" }, 400);
    }

    const [row] = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      (tx) =>
        tx
          .update(contacts)
          .set(set)
          .where(and(eq(contacts.orgId, auth.orgId), eq(contacts.id, id)))
          .returning(),
    );
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ contact: row });
  } catch (err) {
    if (err instanceof ZodError) {
      return c.json({ error: "validation_error", issues: err.issues }, 400);
    }
    if (isFkViolation(err)) {
      return c.json({ error: "invalid_parent", detail: "Parent contact does not exist" }, 400);
    }
    console.error("[updateContact]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Delete a contact. Blocked (409) when vouchers reference it; sub-contacts are
// detached (parent_id → NULL via ON DELETE SET NULL), not deleted.
contactRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id");

  try {
    const deleted = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [row] = await tx
          .delete(contacts)
          .where(and(eq(contacts.orgId, auth.orgId), eq(contacts.id, id)))
          .returning({ id: contacts.id });
        return row;
      },
    );
    if (!deleted) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    if (isFkViolation(err)) {
      return c.json(
        { error: "contact_in_use", detail: "This contact is referenced by vouchers and can't be deleted. Mark it inactive instead." },
        409,
      );
    }
    console.error("[deleteContact]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
