/**
 * Financial report shapes + pure aggregation helpers.
 * The heavy aggregation runs in SQL (see packages/db/migrations/0002_reports.sql);
 * these helpers cover the small derivations and keep them unit-tested.
 */
import type { AccountType } from "./accounts";
import type { Centavos } from "./money";

export interface ReportPeriod {
  from?: string | null;
  to?: string | null;
}

export interface TrialBalanceRow {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitCents: Centavos;
  creditCents: Centavos;
  /** debit − credit; positive = net debit balance. */
  balanceCents: Centavos;
}

export interface TrialBalanceTotals {
  debitCents: Centavos;
  creditCents: Centavos;
  balanced: boolean;
}

export function trialBalanceTotals(rows: readonly TrialBalanceRow[]): TrialBalanceTotals {
  const debitCents = rows.reduce((s, r) => s + r.debitCents, 0);
  const creditCents = rows.reduce((s, r) => s + r.creditCents, 0);
  return { debitCents, creditCents, balanced: debitCents === creditCents };
}

export interface ProfitAndLoss {
  incomeCents: Centavos;
  expenseCents: Centavos;
  netProfitCents: Centavos;
}

/** Net profit = income − expenses (all in centavos). */
export function netProfit(incomeCents: Centavos, expenseCents: Centavos): Centavos {
  return incomeCents - expenseCents;
}
