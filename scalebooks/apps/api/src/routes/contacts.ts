import { Hono } from "hono";
import { ZodError } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { zContactInput, CONTACT_TYPES, type ContactType } from "@scalebooks/domain";
import { withOrgContext, contacts } from "@scalebooks/db";
import { requireAuth } from "../auth";

export const contactRoutes = new Hono();

contactRoutes.use("*", requireAuth);

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

// Create a contact.
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
        const [row] = await tx
          .insert(contacts)
          .values({
            orgId: auth.orgId,
            type: input.type,
            name: input.name,
            tin: input.tin ?? null,
            email: input.email || null,
            phone: input.phone ?? null,
            address: input.address ?? null,
            isActive: input.isActive,
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
    console.error("[createContact]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
