/**
 * Billing / Accounts Receivable (Phase 3): billing statements, service
 * invoices, collections, payment schedules and their recorded payments.
 * Money is integer centavos; balances (netDue − applied, etc.) are computed by
 * the database, so they are deliberately absent from these input schemas.
 * Status vocabularies stay free-form text — the portal owns the transition
 * graph today, and server-side RBAC lands later.
 */
import { z } from "zod";

const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const nullableDate = isoDate.nullable().optional();
const uuidOrNull = z.string().uuid().nullable().optional();

export const zBillingStatementInput = z.object({
  bsNo: z.string().trim().max(40).optional(), // server-assigned when absent
  contactId: uuidOrNull,
  contactName: z.string().trim().min(1, "Client is required").max(200),
  billingDate: isoDate,
  dueDate: nullableDate,
  creditTerm: z.number().int().min(0).max(3650).default(30),
  periodStart: nullableDate,
  periodEnd: nullableDate,
  description: nullableTrimmed(500),
  grossCents: z.number().int().default(0),
  taxGroupName: z.string().trim().max(60).default("VAT"),
  totalVatInclusiveCents: z.number().int().default(0),
  netDueCents: z.number().int().default(0),
  appliedCents: z.number().int().default(0),
  incomeAccount: nullableTrimmed(120),
  lines: z.array(z.record(z.unknown())).nullable().optional(),
  notes: nullableTrimmed(2000),
  status: z.string().trim().max(40).default("Draft"),
  reviewedBy: nullableTrimmed(200),
  approvedBy: nullableTrimmed(200),
  rejectReason: nullableTrimmed(500),
});
export type BillingStatementInput = z.infer<typeof zBillingStatementInput>;
export const zBillingStatementUpdate = zBillingStatementInput.partial();

/**
 * How a sale is treated for VAT. Chooses the issuance journal-entry template
 * and, on collection, whether percentage tax accrues.
 *
 *   vatable    → T1: DR AR / CR Revenue + CR Output Tax
 *   exempt     → T3: DR AR / CR Revenue          (VAT-exempt sale)
 *   zero_rated → T3: DR AR / CR Revenue          (0%-rated, e.g. export)
 *   none       → T2: DR AR / CR Revenue          (non-VAT taxpayer, Sec. 116)
 *
 * exempt / zero_rated / none post IDENTICAL lines — the distinction exists for
 * the VAT return and for the percentage-tax accrual, so it is carried here
 * rather than inferred from the ledger.
 */
export const VAT_TREATMENTS = ["vatable", "exempt", "zero_rated", "none"] as const;
export const zVatTreatment = z.enum(VAT_TREATMENTS);
export type VatTreatment = z.infer<typeof zVatTreatment>;

export const zServiceInvoiceInput = z
  .object({
    siNo: z.string().trim().max(40).optional(), // server-assigned when absent
    contactId: uuidOrNull,
    contactName: z.string().trim().min(1, "Client is required").max(200),
    siDate: isoDate,
    dueDate: nullableDate,
    amountCents: z.number().int().default(0),
    netCents: z.number().int().nonnegative().optional(),
    vatCents: z.number().int().nonnegative().default(0),
    vatTreatment: zVatTreatment.default("none"),
    taxType: z.string().trim().max(40).default("N/A"),
    ewtRate: z.number().min(0).max(1000).default(0),
    incomeAccountCode: nullableTrimmed(40),
    arAccountCode: nullableTrimmed(40),
    outputVatAccountCode: nullableTrimmed(40),
    billingStatementId: nullableTrimmed(80),
    appliedCents: z.number().int().default(0),
    notes: nullableTrimmed(2000),
    status: z.string().trim().max(40).default("Draft"),
    reviewedBy: nullableTrimmed(200),
    approvedBy: nullableTrimmed(200),
    rejectReason: nullableTrimmed(500),
  })
  // `netCents` defaults to "everything that isn't VAT", so existing callers that
  // only send amountCents keep working and still satisfy the DB CHECK.
  .transform((v) => ({ ...v, netCents: v.netCents ?? v.amountCents - v.vatCents }))
  .superRefine((v, ctx) => {
    if (v.amountCents !== v.netCents + v.vatCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountCents"],
        message: `amountCents (${v.amountCents}) must equal netCents (${v.netCents}) + vatCents (${v.vatCents})`,
      });
    }
    // Only a VATable sale carries output VAT. Exempt/zero-rated/non-VAT with a
    // VAT amount is a data error that would post a bogus Output Tax credit.
    if (v.vatTreatment !== "vatable" && v.vatCents !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vatCents"],
        message: `vatCents must be 0 when vatTreatment is '${v.vatTreatment}'`,
      });
    }
  });
export type ServiceInvoiceInput = z.infer<typeof zServiceInvoiceInput>;

/** Partial update — same cross-field rules, applied to whatever is supplied. */
export const zServiceInvoiceUpdate = z
  .object({
    siNo: z.string().trim().max(40).optional(),
    contactId: uuidOrNull,
    contactName: z.string().trim().min(1).max(200).optional(),
    siDate: isoDate.optional(),
    dueDate: nullableDate,
    amountCents: z.number().int().optional(),
    netCents: z.number().int().nonnegative().optional(),
    vatCents: z.number().int().nonnegative().optional(),
    vatTreatment: zVatTreatment.optional(),
    taxType: z.string().trim().max(40).optional(),
    ewtRate: z.number().min(0).max(1000).optional(),
    incomeAccountCode: nullableTrimmed(40),
    arAccountCode: nullableTrimmed(40),
    outputVatAccountCode: nullableTrimmed(40),
    billingStatementId: nullableTrimmed(80),
    appliedCents: z.number().int().optional(),
    notes: nullableTrimmed(2000),
    status: z.string().trim().max(40).optional(),
    reviewedBy: nullableTrimmed(200),
    approvedBy: nullableTrimmed(200),
    rejectReason: nullableTrimmed(500),
  })
  .superRefine((v, ctx) => {
    // Only checkable when the whole triple is supplied; the DB CHECK is the
    // backstop for a partial update that would break the identity.
    if (v.amountCents !== undefined && v.netCents !== undefined && v.vatCents !== undefined) {
      if (v.amountCents !== v.netCents + v.vatCents) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["amountCents"],
          message: "amountCents must equal netCents + vatCents",
        });
      }
    }
    if (v.vatTreatment && v.vatTreatment !== "vatable" && v.vatCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vatCents"],
        message: `vatCents must be 0 when vatTreatment is '${v.vatTreatment}'`,
      });
    }
  });

/** Issue a draft invoice — posts its revenue entry (T1/T2/T3). */
export const zServiceInvoiceIssue = z.object({
  date: isoDate.optional(), // defaults to the invoice date
  /** Overrides for this posting only; otherwise resolved contact → default. */
  arAccountCode: nullableTrimmed(40),
  incomeAccountCode: nullableTrimmed(40),
  outputVatAccountCode: nullableTrimmed(40),
});
export type ServiceInvoiceIssue = z.infer<typeof zServiceInvoiceIssue>;

/** One invoice a collection settles. */
export const zCollectionApplication = z.object({
  invoiceId: z.string().uuid(),
  appliedCents: z.number().int().nonnegative(),
  ewtCents: z.number().int().nonnegative().default(0),
});
export type CollectionApplication = z.infer<typeof zCollectionApplication>;

/**
 * Post a collection to the ledger. The applications must account for exactly
 * what the collection relieves — cash to `appliedCents`, the 2307 amount to
 * `ewtCents` — so the journal entry and the sub-ledger cannot disagree.
 */
export const zCollectionPost = z.object({
  date: isoDate.optional(), // defaults to the collection date
  cashAccountCode: nullableTrimmed(40),
  cwtAccountCode: nullableTrimmed(40),
  arAccountCode: nullableTrimmed(40),
  applications: z.array(zCollectionApplication).min(1, "Apply the collection to at least one invoice"),
});
export type CollectionPost = z.infer<typeof zCollectionPost>;

export const zCollectionInput = z.object({
  collectionNo: z.string().trim().max(40).optional(), // server-assigned when absent
  contactId: uuidOrNull,
  contactName: z.string().trim().min(1, "Client is required").max(200),
  collectionDate: isoDate,
  amountReceivedCents: z.number().int().nonnegative().default(0),
  /** From the payor's BIR 2307 — captured, never derived. Base is net of VAT. */
  ewtCents: z.number().int().nonnegative().default(0),
  appliedCents: z.number().int().default(0),
  method: z.string().trim().max(40).default("Cash"),
  referenceNo: nullableTrimmed(120),
  cashAccountCode: nullableTrimmed(40),
  cwtAccountCode: nullableTrimmed(40),
  arAccountCode: nullableTrimmed(40),
  billingStatementId: nullableTrimmed(80),
  siId: nullableTrimmed(80),
  notes: nullableTrimmed(2000),
  status: z.string().trim().max(40).default("Unposted"),
  postedBy: nullableTrimmed(200),
  postedAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type CollectionInput = z.infer<typeof zCollectionInput>;
export const zCollectionUpdate = zCollectionInput.partial();

export const zPaymentScheduleInput = z.object({
  scheduleNo: z.string().trim().max(40).optional(), // server-assigned when absent
  title: z.string().trim().min(1, "Title is required").max(200),
  contactId: uuidOrNull,
  contactName: nullableTrimmed(200),
  category: nullableTrimmed(120),
  frequency: z.string().trim().max(40).default("Monthly"),
  amountCents: z.number().int().default(0),
  dueDate: nullableDate,
  startDate: nullableDate,
  endDate: nullableDate,
  dueDay: z.number().int().min(0).max(31).default(0),
  status: z.string().trim().max(40).default("Active"),
  notes: nullableTrimmed(2000),
  defaultExpenseAccountCode: nullableTrimmed(40),
  defaultTaxRateId: nullableTrimmed(80),
  paymentMethod: nullableTrimmed(40),
  pmConfig: z.record(z.unknown()).nullable().optional(),
});
export type PaymentScheduleInput = z.infer<typeof zPaymentScheduleInput>;
export const zPaymentScheduleUpdate = zPaymentScheduleInput.partial();

export const zSchedulePaymentInput = z.object({
  scheduleId: uuidOrNull,
  scheduleTitle: nullableTrimmed(200),
  dueDate: nullableDate,
  payDate: isoDate,
  amountCents: z.number().int().default(0),
  method: nullableTrimmed(40),
  bank: nullableTrimmed(40),
  checkId: nullableTrimmed(80),
  checkNumber: nullableTrimmed(40),
  checkRegisterId: nullableTrimmed(80),
  voucherNo: nullableTrimmed(40),
  voucherDocId: uuidOrNull,
  notes: nullableTrimmed(2000),
});
export type SchedulePaymentInput = z.infer<typeof zSchedulePaymentInput>;
export const zSchedulePaymentUpdate = zSchedulePaymentInput.partial();
