/**
 * Operations domain: checkbooks, the check registry, disbursement reports, and
 * org settings. These are operational documents (not ledger primitives) — jsonb
 * carries report snapshots/config faithfully; money is integer centavos.
 */
import { z } from "zod";

const optionalTrimmed = (max: number) => z.string().trim().max(max).optional();
const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// ── Checkbooks ────────────────────────────────────────────────────────────────
export const zCheckbookInput = z.object({
  bankCode: z.string().trim().min(1, "Bank is required").max(40),
  checkbookType: optionalTrimmed(20),
  startingNumber: z.string().trim().min(1, "Starting series required").max(20),
  endingNumber: nullableTrimmed(20),
  checksCount: z.number().int().positive().nullable().optional(),
  nextCheckNumber: nullableTrimmed(20),
  isActive: z.boolean().default(true),
  notes: nullableTrimmed(2000),
});
export type CheckbookInput = z.infer<typeof zCheckbookInput>;
export const zCheckbookUpdate = zCheckbookInput.partial();
export type CheckbookUpdate = z.infer<typeof zCheckbookUpdate>;

// ── Check registry ────────────────────────────────────────────────────────────
export const CHECK_STATUSES = ["Issued", "Cleared", "Voided", "Stopped", "Stale"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export const zCheckInput = z.object({
  checkNo: optionalTrimmed(40), // server-assigned when absent
  checkbookId: z.string().uuid().nullable().optional(),
  bankCode: optionalTrimmed(40),
  checkNumber: z.string().trim().min(1, "Check number required").max(20),
  checkDate: isoDate.nullable().optional(),
  issueDate: isoDate.nullable().optional(),
  payeeName: optionalTrimmed(200),
  amountCents: z.number().int().positive(),
  netAmountCents: z.number().int().nonnegative().nullable().optional(),
  referenceType: nullableTrimmed(40),
  referenceId: nullableTrimmed(80),
  voucherId: z.string().uuid().nullable().optional(),
  journalEntryId: z.string().uuid().nullable().optional(),
  isPartOfMultiple: z.boolean().optional(),
  lineNo: z.number().int().positive().nullable().optional(),
  notes: nullableTrimmed(2000),
  meta: z.record(z.unknown()).nullable().optional(),
});
export type CheckInput = z.infer<typeof zCheckInput>;
export const zCheckUpdate = zCheckInput.partial();
export type CheckUpdate = z.infer<typeof zCheckUpdate>;

export const zCheckStatusUpdate = z.object({
  status: z.enum(CHECK_STATUSES),
  date: isoDate.optional(),
  reason: optionalTrimmed(500),
});

// ── Disbursement reports ──────────────────────────────────────────────────────
export const DISBURSEMENT_STATUSES = [
  "Pending",
  "For Verification",
  "Verified",
  "For Approval",
  "Approved",
  "Rejected",
  "In Disbursement",
  "Disbursed",
  "Voided",
] as const;
export type DisbursementStatus = (typeof DISBURSEMENT_STATUSES)[number];

export const zDisbursementLine = z
  .object({
    // The portal keeps its human voucher number in voucherId and the Postgres
    // uuid in voucherDocId; the server parks/reverts by whichever is uuid-shaped.
    voucherId: z.string().max(80).nullable().optional(),
    voucherDocId: z.string().uuid().nullable().optional(),
    voucherNo: optionalTrimmed(40),
    amountCents: z.number().int().nonnegative().optional(),
  })
  .passthrough(); // report lines are a snapshot — keep whatever the UI adds

export const zDisbursementReportInput = z.object({
  reportDate: isoDate,
  bankCode: optionalTrimmed(40),
  totalCents: z.number().int().nonnegative().default(0),
  expectedCollectionCents: z.number().int().nonnegative().default(0),
  notes: nullableTrimmed(4000),
  bankBalances: z.unknown().nullable().optional(),
  lines: z.array(zDisbursementLine).default([]),
  meta: z.record(z.unknown()).nullable().optional(),
});
export type DisbursementReportInput = z.infer<typeof zDisbursementReportInput>;
export const zDisbursementReportUpdate = zDisbursementReportInput.partial();
export type DisbursementReportUpdate = z.infer<typeof zDisbursementReportUpdate>;

export const zDisbursementStatusUpdate = z.object({
  status: z.enum(DISBURSEMENT_STATUSES),
  reason: optionalTrimmed(500),
});

// ── Org settings ─────────────────────────────────────────────────────────────
export const zOrgSettingsUpdate = z.object({
  profile: z.record(z.unknown()).nullable().optional(),
  approvalRouting: z.record(z.unknown()).nullable().optional(),
  docNumbering: z.record(z.unknown()).nullable().optional(),
});
export type OrgSettingsUpdate = z.infer<typeof zOrgSettingsUpdate>;
