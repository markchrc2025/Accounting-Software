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
  isActive: z.boolean().default(true),
});

export type AccountInput = z.infer<typeof zAccountInput>;

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
