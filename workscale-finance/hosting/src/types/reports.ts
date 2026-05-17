// ── Report filter types ────────────────────────────────────────────────

export type AccountingMethod = 'Cash' | 'Accrual';

export type DisplayColumnsBy =
  | 'Total only'
  | 'Days'
  | 'Weeks'
  | 'Months'
  | 'Quarters'
  | 'Years'
  | 'Customers'
  | 'Vendors'
  | 'Employees'
  | 'Classes'
  | 'Locations';

export type CompareTo =
  | ''
  | 'Previous period'
  | 'Previous year'
  | 'Year-to-date';

export type ReportDensity = 'Compact' | 'Comfortable' | 'Spacious';

export type ReportPeriodPreset =
  | 'today'
  | 'this_week'
  | 'this_week_to_date'
  | 'this_month'
  | 'this_month_to_date'
  | 'this_quarter'
  | 'this_quarter_to_date'
  | 'this_fiscal_quarter'
  | 'this_fiscal_quarter_to_date'
  | 'this_year'
  | 'this_year_to_date'
  | 'this_year_to_last_month'
  | 'this_financial_year'
  | 'this_financial_year_to_date'
  | 'this_financial_year_to_last_month'
  | 'last_6_months'
  | 'yesterday'
  | 'last_week'
  | 'last_week_to_date'
  | 'last_week_to_today'
  | 'last_month'
  | 'last_month_to_date'
  | 'last_month_to_today'
  | 'last_quarter'
  | 'last_quarter_to_date'
  | 'last_quarter_to_today'
  | 'last_fiscal_quarter'
  | 'last_fiscal_quarter_to_date'
  | 'last_year'
  | 'last_year_to_date'
  | 'last_year_to_today'
  | 'last_financial_year'
  | 'last_financial_year_to_date'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'last_12_months'
  | 'since_30_days_ago'
  | 'since_60_days_ago'
  | 'since_90_days_ago'
  | 'since_365_days_ago'
  | 'next_week'
  | 'next_4_weeks'
  | 'next_month'
  | 'next_quarter'
  | 'next_fiscal_quarter'
  | 'next_year'
  | 'next_financial_year'
  | 'custom';

export interface ReportFilters {
  period: ReportPeriodPreset;
  from: string;   // YYYY-MM-DD
  to: string;     // YYYY-MM-DD
  method: AccountingMethod;
  columns: DisplayColumnsBy;
  compareTo: CompareTo;
}

export interface PeriodOption {
  value: ReportPeriodPreset;
  label: string;
}

export interface PeriodGroup {
  label: string | null;
  items: PeriodOption[];
}

// ── Report data types ──────────────────────────────────────────────────

export interface JournalLine {
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  jeId: string;
  date: string;
  description: string;
  type: string;
  reference: string;
  status: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
}

export interface AccountRecord {
  id: string;
  code: string;
  name: string;
  type: string;
  subType: string;
  normalBalance: 'Debit' | 'Credit';
}

export interface BillingStatement {
  id: string;
  bsId: string;
  contactName: string;
  billingDate: string;
  dueDate: string;
  creditTerm: number;
  netDue: number;
  balance: number;
  appliedAmount: number;
  status: string;
}

export interface PaymentSchedule {
  id: string;
  scheduleId: string;
  name: string;
  contactName: string;
  category: string;
  frequency: string;
  startDate: string;
  dueDate: string;
  dueDay: number;
  endDate: string;
  amount: number;
  status: string;
  paymentMethod: string;
}

// ── Report output types ────────────────────────────────────────────────

export type ReportType =
  | 'general_ledger'
  | 'trial_balance'
  | 'income_statement'
  | 'balance_sheet'
  | 'aging_receivables'
  | 'payment_schedule';

export interface GLAccountGroup {
  accountCode: string;
  accountName: string;
  accountType: string;
  openingBalance: number;
  lines: Array<{
    date: string;
    jeId: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

export interface TrialBalanceLine {
  accountCode: string;
  accountName: string;
  accountType: string;
  debitBalance: number;
  creditBalance: number;
}

export interface ISSection {
  label: string;
  accounts: Array<{ code: string; name: string; subType: string; amount: number }>;
  total: number;
}

export interface BSSection {
  label: string;
  subSections: Array<{
    label: string;
    accounts: Array<{ code: string; name: string; amount: number }>;
    subtotal: number;
  }>;
  total: number;
}

export interface AgingBucket {
  contactName: string;
  current: number;   // 0–30
  days31_60: number;
  days61_90: number;
  days91_120: number;
  over120: number;
  total: number;
}
