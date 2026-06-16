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
  code: string;
  name: string;
  type: AccountType;
}

/**
 * A sensible default chart for a Philippine SME. Seeded into each new org; the
 * org can rename/add/deactivate afterward.
 */
export const DEFAULT_CHART_OF_ACCOUNTS: readonly ChartAccount[] = [
  // Assets (1000)
  { code: "1000", name: "Cash on Hand", type: "asset" },
  { code: "1010", name: "Cash in Bank", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "1200", name: "Input VAT", type: "asset" },
  { code: "1300", name: "Prepaid Expenses", type: "asset" },
  { code: "1500", name: "Property, Plant & Equipment", type: "asset" },
  { code: "1510", name: "Accumulated Depreciation", type: "asset" }, // contra-asset
  // Liabilities (2000)
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Output VAT", type: "liability" },
  { code: "2110", name: "Withholding Tax Payable", type: "liability" },
  { code: "2200", name: "SSS / PhilHealth / HDMF Payable", type: "liability" },
  { code: "2300", name: "Loans Payable", type: "liability" },
  // Equity (3000)
  { code: "3000", name: "Owner's Capital", type: "equity" },
  { code: "3100", name: "Retained Earnings", type: "equity" },
  // Income (4000)
  { code: "4000", name: "Service Revenue", type: "income" },
  { code: "4100", name: "Interest Income", type: "income" },
  // Expenses (5000)
  { code: "5000", name: "Salaries and Wages", type: "expense" },
  { code: "5100", name: "Rent Expense", type: "expense" },
  { code: "5200", name: "Utilities Expense", type: "expense" },
  { code: "5300", name: "Office Supplies", type: "expense" },
  { code: "5400", name: "Depreciation Expense", type: "expense" },
  { code: "5500", name: "Professional Fees", type: "expense" },
  { code: "5900", name: "Miscellaneous Expense", type: "expense" },
];
