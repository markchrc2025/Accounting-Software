/**
 * Chart of Accounts domain: account types, normal-balance rules, validation,
 * and a standard Philippine default chart used to seed a new organization.
 */
import { z } from "zod";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type NormalBalance = "debit" | "credit";

/** Assets and expenses are debit-normal; liabilities, equity, income are credit-normal. */
export function normalBalanceFor(type: AccountType): NormalBalance {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

export const zAccountInput = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Account code is required")
    .max(20)
    .regex(/^[0-9A-Za-z.\-]+$/, "Code may contain only letters, digits, dot, and dash"),
  name: z.string().trim().min(1, "Account name is required").max(120),
  type: z.enum(ACCOUNT_TYPES),
  subtype: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isActive: z.boolean().default(true),
});

export type AccountInput = z.infer<typeof zAccountInput>;

/** Partial update of an account. Any omitted field is left unchanged; subtype and
 * description may be set to null to clear them. */
export const zAccountUpdate = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[0-9A-Za-z.\-]+$/, "Code may contain only letters, digits, dot, and dash"),
    name: z.string().trim().min(1).max(120),
    type: z.enum(ACCOUNT_TYPES),
    subtype: z.string().trim().max(120).nullable(),
    description: z.string().trim().max(2000).nullable(),
    isActive: z.boolean(),
  })
  .partial();

export type AccountUpdate = z.infer<typeof zAccountUpdate>;

/**
 * A single account row from a Chart-of-Accounts import (e.g. an uploaded Excel).
 * More lenient than zAccountInput: codes are freeform display labels (real charts
 * use things like "DO101"), parents are referenced by name, and the normal
 * balance is optional (derived from the type when absent).
 */
export const zImportAccount = z.object({
  code: z.string().trim().max(40).default(""),
  name: z.string().trim().min(1, "Account name is required").max(160),
  type: z.enum(ACCOUNT_TYPES),
  subtype: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  normalBalance: z.enum(["debit", "credit"]).optional(),
  parentName: z.string().trim().max(160).optional(),
});
export type ImportAccount = z.infer<typeof zImportAccount>;

/** Payload for POST /accounts/import — up to 5000 rows at a time. */
export const zImportAccounts = z.object({
  accounts: z.array(zImportAccount).min(1, "No accounts to import").max(5000),
});
export type ImportAccounts = z.infer<typeof zImportAccounts>;

export interface ChartAccount {
  /** Display label. Real charts reuse codes across types, so it is NOT unique. */
  code: string;
  /** The unique key within an org. */
  name: string;
  type: AccountType;
  /** Normal balance side ("debit"/"credit"). */
  normalBalance: NormalBalance;
  /** Zoho-style detailed classification (Bank, Accounts Receivable, …). */
  subtype?: string;
  description?: string;
  /** Parent account, referenced by name (resolved to parent_id at seed time). */
  parentName?: string;
}

/**
 * The software's default Chart of Accounts, provisioned for every organization.
 * Generated from the source export — see setup/generate_coa_sql.py and
 * ./defaultChart.generated.ts. Orgs can rename/add/deactivate afterward.
 */
export { DEFAULT_CHART_OF_ACCOUNTS } from "./defaultChart.generated";
