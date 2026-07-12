/**
 * Reference data (Phases 4-5): tax rates/groups, purpose categories, and bank
 * management records. Simple org-scoped CRUD documents; rates are percentages,
 * money is integer centavos.
 */
import { z } from "zod";

const optionalTrimmed = (max: number) => z.string().trim().max(max).optional();
const nullableTrimmed = (max: number) => z.string().trim().max(max).nullable().optional();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

export const zTaxRateInput = z.object({
  name: z.string().trim().min(1, "Tax name is required").max(120),
  rate: z.number().min(0).max(1000).default(0),
  trackingType: z.enum(["single", "separate"]).default("single"),
  taxAccountSingle: nullableTrimmed(40),
  taxAccountSales: nullableTrimmed(40),
  taxAccountPurchases: nullableTrimmed(40),
  isActive: z.boolean().default(true),
});
export type TaxRateInput = z.infer<typeof zTaxRateInput>;
export const zTaxRateUpdate = zTaxRateInput.partial();

export const zTaxGroupInput = z.object({
  name: z.string().trim().min(1, "Group name is required").max(120),
  rateNames: z.array(z.string().trim().max(120)).min(1, "Select at least one tax rate"),
  isActive: z.boolean().default(true),
});
export type TaxGroupInput = z.infer<typeof zTaxGroupInput>;
export const zTaxGroupUpdate = zTaxGroupInput.partial();

export const zPurposeCategoryInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
});
export const zPurposeCategoryUpdate = zPurposeCategoryInput.partial();

export const zBankBalanceInput = z.object({
  bankCode: z.string().trim().min(1, "Bank is required").max(40),
  balanceDate: isoDate,
  beginningCents: z.number().int().default(0),
  endingCents: z.number().int().default(0),
  notes: nullableTrimmed(2000),
});
export type BankBalanceInput = z.infer<typeof zBankBalanceInput>;
export const zBankBalanceUpdate = zBankBalanceInput.partial();

export const zBankTransactionInput = z.object({
  bankCode: z.string().trim().min(1, "Bank is required").max(40),
  txDate: isoDate,
  description: nullableTrimmed(500),
  reference: nullableTrimmed(120),
  debitCents: z.number().int().nonnegative().default(0),
  creditCents: z.number().int().nonnegative().default(0),
  txType: nullableTrimmed(40),
  status: nullableTrimmed(40),
  source: optionalTrimmed(40),
});
export type BankTransactionInput = z.infer<typeof zBankTransactionInput>;
export const zBankTransactionUpdate = zBankTransactionInput.partial();

export const zBankReconciliationInput = z.object({
  reconNo: optionalTrimmed(40), // server-assigned when absent
  bankCode: z.string().trim().min(1, "Bank is required").max(40),
  beginningCents: z.number().int().default(0),
  endingCents: z.number().int().default(0),
  periodEnding: isoDate.nullable().optional(),
  clearedCount: z.number().int().nonnegative().default(0),
  meta: z.record(z.unknown()).nullable().optional(),
});
export type BankReconciliationInput = z.infer<typeof zBankReconciliationInput>;
export const zBankReconciliationUpdate = zBankReconciliationInput.partial();
