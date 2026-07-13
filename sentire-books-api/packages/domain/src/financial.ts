/**
 * Financial management (Phase 6): loans, loan payments, fixed assets + types,
 * asset installment payments, depreciation posting locks, weekly cash
 * projections, and credit lines. Money is integer centavos in typed columns;
 * pesos inside UI-owned jsonb (allocations, projection lines, pm configs);
 * rates are numeric percentages. The amortization/depreciation engines stay
 * client-side — these are the storage rows they read.
 */
import { z } from "zod";

const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const nullableDate = isoDate.nullable().optional();
const uuidOrNull = z.string().uuid().nullable().optional();
const dayOfMonth = z.number().int().min(1).max(31).nullable().optional();
const jsonBag = z.record(z.unknown()).nullable().optional();

export const zLoanInput = z.object({
  loanNo: z.string().trim().max(40).optional(), // server-assigned when absent
  name: z.string().trim().min(1, "Lender is required").max(200),
  loanType: z.string().trim().max(60).default("Term Loan"),
  disbursementDate: nullableDate,
  proceedsDate: nullableDate,
  termMonths: z.number().int().min(1).max(1200).default(60),
  annualRate: z.number().min(0).max(1000).default(0),
  principalCents: z.number().int().default(0),
  interestMethod: z.string().trim().max(60).default("Reducing Balance"),
  processingFeeCents: z.number().int().default(0),
  status: z.string().trim().max(40).default("Active"),
  paymentFrequency: z.string().trim().max(40).default("Monthly"),
  payDayMode: z.string().trim().max(40).default("Fixed"),
  payDay1: dayOfMonth,
  payDay2: dayOfMonth,
  payDaysPerMonth: jsonBag,
  intervalDays: z.number().int().min(1).max(365).default(15),
  paymentMethod: nullableTrimmed(40),
  pmConfig: jsonBag,
  // GL account mappings (codes; resolved to account ids when booking/paying).
  liabilityAccountCode: nullableTrimmed(40),
  financeCostAccountCode: nullableTrimmed(40),
  cashAccountCode: nullableTrimmed(40),
});
export type LoanInput = z.infer<typeof zLoanInput>;
export const zLoanUpdate = zLoanInput.partial();

/** Book a loan to the ledger — posts its origination journal entry. */
export const zLoanBook = z.object({
  mode: z.enum(["disbursement", "opening_balance"]).default("disbursement"),
  date: isoDate.optional(),                          // defaults to disbursement date / today
  openingEquityAccountCode: nullableTrimmed(40),     // opening_balance: default 2004002
  outstandingCents: z.number().int().nonnegative().optional(), // opening_balance: default principal
});
export type LoanBook = z.infer<typeof zLoanBook>;

/**
 * Record a loan payment — FM is the source of truth and originates the
 * disbursement instrument. Bank Transfer / Cash / Online / Auto-Debit produce a
 * Payment Voucher (JE posts at approval); Check produces a Check Voucher + a
 * Check Registry entry (JE posts when the check clears). The payment JE is
 * DR Loans Payable + DR Finance Cost / CR Cash — the detail lines the voucher
 * carries. Amounts are peso-centavos; interest and penalty both hit Finance Cost.
 */
export const LOAN_PAYMENT_METHODS = ["Check", "Auto-Debit", "Bank Transfer", "Cash", "Online"] as const;
export const zLoanPay = z.object({
  payDate: isoDate,
  method: z.enum(LOAN_PAYMENT_METHODS).default("Bank Transfer"),
  interestCents: z.number().int().nonnegative().default(0),
  principalCents: z.number().int().nonnegative().default(0),
  penaltyCents: z.number().int().nonnegative().default(0),
  cashAccountCode: nullableTrimmed(40),   // overrides the loan's cash account for this payment
  bank: nullableTrimmed(120),
  referenceNo: nullableTrimmed(120),      // transaction ref (or check no. for non-PDC)
  // Post-dated check (method 'Check') specifics — the physical check that clears later.
  checkNumber: nullableTrimmed(40),
  checkDate: nullableDate,                // check maturity date
  checkbookId: uuidOrNull,
  payeeName: nullableTrimmed(200),
  notes: nullableTrimmed(2000),
  allocations: z.array(z.record(z.unknown())).nullable().optional(),
  voucherDate: isoDate.optional(),        // defaults to payDate
});
export type LoanPay = z.infer<typeof zLoanPay>;

export const zLoanPaymentInput = z.object({
  loanId: uuidOrNull,
  loanName: nullableTrimmed(200),
  payDate: isoDate,
  interestCents: z.number().int().default(0),
  principalCents: z.number().int().default(0),
  penaltyCents: z.number().int().default(0),
  totalCents: z.number().int().default(0),
  method: nullableTrimmed(40),
  referenceNo: nullableTrimmed(120),
  bank: nullableTrimmed(120),
  voucherNo: nullableTrimmed(40),
  voucherDocId: uuidOrNull,
  checkVoucherNo: nullableTrimmed(40),
  notes: nullableTrimmed(2000),
  allocations: z.array(z.record(z.unknown())).nullable().optional(),
});
export type LoanPaymentInput = z.infer<typeof zLoanPaymentInput>;
export const zLoanPaymentUpdate = zLoanPaymentInput.partial();

export const zAssetTypeInput = z.object({
  typeNo: nullableTrimmed(20),
  name: z.string().trim().min(1, "Type name is required").max(120),
  depreciationMethod: z.string().trim().max(60).default("Straight Line"),
  usefulLifeMonths: z.number().int().min(0).max(1200).nullable().optional(),
  fixedAssetAccount: nullableTrimmed(40),
  accumDeprecAccount: nullableTrimmed(40),
  deprecExpenseAccount: nullableTrimmed(40),
});
export const zAssetTypeUpdate = zAssetTypeInput.partial();

export const zFixedAssetInput = z.object({
  assetNo: z.string().trim().min(1, "Asset number is required").max(20),
  name: z.string().trim().min(1, "Asset name is required").max(200),
  assetType: nullableTrimmed(120),
  purchaseDate: nullableDate,
  deprecStartDate: nullableDate,
  costCents: z.number().int().default(0),
  residualCents: z.number().int().default(0),
  usefulLifeMonths: z.number().int().min(0).max(1200).default(0),
  depreciationMethod: z.string().trim().max(60).default("Straight Line"),
  computationType: z.string().trim().max(40).default("Non Pro Rata"),
  fixedAssetAccount: nullableTrimmed(40),
  accumDeprecAccount: nullableTrimmed(40),
  deprecExpenseAccount: nullableTrimmed(40),
  status: z.string().trim().max(40).default("Active"),
  disposalDate: nullableDate,
  notes: nullableTrimmed(2000),
  isInstallment: z.boolean().default(false),
  installmentPrincipalCents: z.number().int().default(0),
  installmentStartDate: nullableDate,
  installmentTermMonths: z.number().int().min(0).max(1200).default(0),
  installmentAnnualRate: z.number().min(0).max(1000).default(0),
  installmentMethod: z.string().trim().max(60).default("Reducing Balance"),
  installmentPayableAccount: nullableTrimmed(40),
  installmentAmortizationAccount: nullableTrimmed(40),
  paymentMethod: nullableTrimmed(40),
  pmConfig: jsonBag,
});
export type FixedAssetInput = z.infer<typeof zFixedAssetInput>;
export const zFixedAssetUpdate = zFixedAssetInput.partial();

export const zAssetInstallmentPaymentInput = z.object({
  assetId: uuidOrNull,
  assetName: nullableTrimmed(200),
  period: z.number().int().min(1),
  label: nullableTrimmed(20),
  payDate: isoDate,
  principalCents: z.number().int().default(0),
  interestCents: z.number().int().default(0),
  totalCents: z.number().int().default(0),
  method: nullableTrimmed(40),
  bank: nullableTrimmed(40),
  checkId: nullableTrimmed(80),
  checkNumber: nullableTrimmed(40),
  checkRegisterId: nullableTrimmed(80),
  voucherNo: nullableTrimmed(40),
  voucherDocId: uuidOrNull,
  notes: nullableTrimmed(2000),
});
export const zAssetInstallmentPaymentUpdate = zAssetInstallmentPaymentInput.partial();

export const zAssetDeprPostingInput = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, "Period must be YYYY-MM"),
  journalEntryId: uuidOrNull,
  totalCents: z.number().int().default(0),
  assetCount: z.number().int().nonnegative().default(0),
});
export const zAssetDeprPostingUpdate = zAssetDeprPostingInput.partial();

export const zWeeklyProjectionInput = z.object({
  projNo: z.string().trim().max(40).optional(), // server-assigned when absent
  weekCoverage: nullableTrimmed(120),
  startDate: nullableDate,
  endDate: nullableDate,
  status: z.string().trim().max(40).default("Draft"),
  totalOutCents: z.number().int().default(0),
  totalInCents: z.number().int().default(0),
  notes: nullableTrimmed(2000),
  lines: z.array(z.record(z.unknown())).nullable().optional(),
  inflowLines: z.array(z.record(z.unknown())).nullable().optional(),
});
export type WeeklyProjectionInput = z.infer<typeof zWeeklyProjectionInput>;
export const zWeeklyProjectionUpdate = zWeeklyProjectionInput.partial();

export const zCreditLineInput = z.object({
  bankCode: nullableTrimmed(40),
  displayName: z.string().trim().min(1, "Name is required").max(200),
  creditLimitCents: z.number().int().default(0),
  interestRate: z.number().min(0).max(1000).default(0),
  availableBalanceCents: z.number().int().default(0),
  asOfDate: nullableDate,
  notes: nullableTrimmed(2000),
});
export const zCreditLineUpdate = zCreditLineInput.partial();
