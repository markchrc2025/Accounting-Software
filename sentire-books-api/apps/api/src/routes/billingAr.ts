/**
 * Billing / Accounts Receivable routes.
 *
 * Phase 3 landed these as plain CRUD. M2.1 gives SERVICE INVOICES a ledger
 * footprint: issuing an invoice posts its revenue entry, cancelling reverses
 * it, and the account codes used are snapshotted onto the invoice so later
 * contact edits cannot move history.
 *
 * Billing statements stay presentation-only and are deliberately NOT posted —
 * they are a client-facing summary over invoices, and posting both would
 * double-count revenue.
 */
import {
  zBillingStatementInput,
  zBillingStatementUpdate,
  zServiceInvoiceInput,
  zServiceInvoiceUpdate,
  zServiceInvoiceIssue,
  zCollectionInput,
  zCollectionUpdate,
  zPaymentScheduleInput,
  zPaymentScheduleUpdate,
  zSchedulePaymentInput,
  zSchedulePaymentUpdate,
} from "@sentire-books/domain";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import {
  withOrgContext,
  billingStatements,
  serviceInvoices,
  collections,
  contacts,
  paymentSchedules,
  schedulePayments,
} from "@sentire-books/db";
import { makeCrudRoutes } from "./crudFactory";
import { requireAuth, requireWorkflowPoster } from "../auth";
import { reportError } from "../observability";
import {
  AmbiguousAccountCodeError,
  ambiguousAccountResponse,
} from "../ledger/resolveAccounts";
import {
  issueInvoiceTx,
  cancelInvoiceTx,
  ISSUED_STATUS,
  type IssueFailure,
} from "../ledger/postInvoice";

export const billingStatementRoutes = makeCrudRoutes({
  plural: "statements",
  singular: "statement",
  table: billingStatements,
  createSchema: zBillingStatementInput,
  updateSchema: zBillingStatementUpdate,
  orderBy: [{ column: billingStatements.createdAt, dir: "desc" }],
  docNo: { field: "bsNo", prefix: "BS", dateField: "billingDate" },
});

export const serviceInvoiceRoutes = makeCrudRoutes({
  plural: "invoices",
  singular: "invoice",
  table: serviceInvoices,
  createSchema: zServiceInvoiceInput,
  updateSchema: zServiceInvoiceUpdate,
  orderBy: [{ column: serviceInvoices.createdAt, dir: "desc" }],
  docNo: { field: "siNo", prefix: "IS", dateField: "siDate" },
  // Reverse-only, as with loans and fixed assets: an issued invoice must be
  // cancelled (which reverses its entry), never hard-deleted out from under it.
  disableDelete: true,
});

/** 400/409 bodies for the ways issuing can legitimately fail. */
const issueErrorResponse = (error: IssueFailure) => {
  switch (error) {
    case "already_issued":
      return { body: { error, detail: "This invoice is already issued to the ledger." }, status: 409 as const };
    case "not_draft":
      return {
        body: { error, detail: "Only a Draft invoice can be issued. Cancel and re-create it instead." },
        status: 409 as const,
      };
    case "nothing_to_issue":
      return { body: { error, detail: "Invoice amount must be greater than zero." }, status: 400 as const };
    case "accounts_unset":
      return {
        body: {
          error,
          detail:
            "Set the receivable and income accounts before issuing — either on the invoice, " +
            "or as the customer's AR account on their contact record.",
        },
        status: 400 as const,
      };
    case "vat_account_unset":
      return {
        body: { error, detail: "A VATable invoice needs an output VAT account (default 2003003 Output Tax)." },
        status: 400 as const,
      };
  }
};

/**
 * Issue a draft invoice — posts T1 (VATable), T2 (non-VAT) or T3 (exempt /
 * zero-rated) depending on the invoice's own vatTreatment, and flips it to
 * Issued. Both happen in one transaction, so an invoice is Issued if and only
 * if its entry is on the books.
 *
 * Unlike loans (which book at registration), invoices book at ISSUE: a Draft
 * invoice is still being edited and must not touch the general ledger.
 */
serviceInvoiceRoutes.post("/:id/issue", requireAuth, requireWorkflowPoster, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id") ?? "";
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  try {
    const input = zServiceInvoiceIssue.parse(body ?? {});
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [invoice] = await tx
          .select()
          .from(serviceInvoices)
          .where(and(eq(serviceInvoices.orgId, auth.orgId), eq(serviceInvoices.id, id)));
        if (!invoice) return { error: "not_found" as const };

        // The customer's own AR sub-account, when they have one.
        let contactAr: string | null = null;
        if (invoice.contactId) {
          const [contact] = await tx
            .select({ arAccountCode: contacts.arAccountCode })
            .from(contacts)
            .where(and(eq(contacts.orgId, auth.orgId), eq(contacts.id, invoice.contactId)));
          contactAr = contact?.arAccountCode ?? null;
        }

        return issueInvoiceTx(tx, invoice, { ...input, contactArAccountCode: contactAr }, auth.orgId, auth.userId);
      },
    );

    if ("error" in outcome && outcome.error === "not_found") return c.json({ error: "not_found" }, 404);
    if ("ok" in outcome && outcome.ok) {
      return c.json({ invoice: outcome.invoice, journalEntryNo: outcome.journalEntryNo, lines: outcome.lines });
    }
    const { body: b, status } = issueErrorResponse((outcome as { error: IssueFailure }).error);
    return c.json(b, status);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    if (err instanceof AmbiguousAccountCodeError) {
      const { body: b, status } = ambiguousAccountResponse(err);
      return c.json(b, status);
    }
    reportError(c, "issueInvoice", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

/**
 * Cancel an invoice — never deleted, only cancelled. Reverses its issuance
 * entry (if issued) and marks it Cancelled. Blocked once collections have been
 * applied against it, so nothing is left orphaned.
 */
serviceInvoiceRoutes.post("/:id/cancel", requireAuth, requireWorkflowPoster, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id") ?? "";
  try {
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [invoice] = await tx
          .select()
          .from(serviceInvoices)
          .where(and(eq(serviceInvoices.orgId, auth.orgId), eq(serviceInvoices.id, id)));
        if (!invoice) return { error: "not_found" as const };
        return cancelInvoiceTx(tx, invoice, auth.orgId, auth.userId);
      },
    );
    if ("error" in outcome) {
      if (outcome.error === "not_found") return c.json({ error: "not_found" }, 404);
      if (outcome.error === "already_cancelled") {
        return c.json({ error: "already_cancelled", detail: "This invoice is already cancelled." }, 409);
      }
      return c.json(
        {
          error: "has_collections",
          detail: "This invoice has collections applied — void those before cancelling.",
        },
        409,
      );
    }
    return c.json(outcome);
  } catch (err) {
    reportError(c, "cancelInvoice", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

export const collectionRoutes = makeCrudRoutes({
  plural: "collections",
  singular: "collection",
  table: collections,
  createSchema: zCollectionInput,
  updateSchema: zCollectionUpdate,
  orderBy: [{ column: collections.createdAt, dir: "desc" }],
  docNo: { field: "collectionNo", prefix: "COL", dateField: "collectionDate" },
});

export const paymentScheduleRoutes = makeCrudRoutes({
  plural: "schedules",
  singular: "schedule",
  table: paymentSchedules,
  createSchema: zPaymentScheduleInput,
  updateSchema: zPaymentScheduleUpdate,
  orderBy: [{ column: paymentSchedules.createdAt, dir: "desc" }],
  docNo: { field: "scheduleNo", prefix: "PS", dateField: "startDate" },
});

export const schedulePaymentRoutes = makeCrudRoutes({
  plural: "payments",
  singular: "payment",
  table: schedulePayments,
  createSchema: zSchedulePaymentInput,
  updateSchema: zSchedulePaymentUpdate,
  orderBy: [{ column: schedulePayments.createdAt, dir: "desc" }],
});

export { ISSUED_STATUS };
