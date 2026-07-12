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

export const zServiceInvoiceInput = z.object({
  siNo: z.string().trim().max(40).optional(), // server-assigned when absent
  contactId: uuidOrNull,
  contactName: z.string().trim().min(1, "Client is required").max(200),
  siDate: isoDate,
  dueDate: nullableDate,
  amountCents: z.number().int().default(0),
  taxType: z.string().trim().max(40).default("N/A"),
  ewtRate: z.number().min(0).max(1000).default(0),
  incomeAccountCode: nullableTrimmed(40),
  billingStatementId: nullableTrimmed(80),
  appliedCents: z.number().int().default(0),
  notes: nullableTrimmed(2000),
  status: z.string().trim().max(40).default("Draft"),
  reviewedBy: nullableTrimmed(200),
  approvedBy: nullableTrimmed(200),
  rejectReason: nullableTrimmed(500),
});
export type ServiceInvoiceInput = z.infer<typeof zServiceInvoiceInput>;
export const zServiceInvoiceUpdate = zServiceInvoiceInput.partial();

export const zCollectionInput = z.object({
  collectionNo: z.string().trim().max(40).optional(), // server-assigned when absent
  contactId: uuidOrNull,
  contactName: z.string().trim().min(1, "Client is required").max(200),
  collectionDate: isoDate,
  amountReceivedCents: z.number().int().default(0),
  appliedCents: z.number().int().default(0),
  method: z.string().trim().max(40).default("Cash"),
  referenceNo: nullableTrimmed(120),
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
