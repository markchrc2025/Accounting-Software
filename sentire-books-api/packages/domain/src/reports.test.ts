import { describe, it, expect } from "vitest";
import { netProfit, trialBalanceTotals, type TrialBalanceRow } from "./reports";
import { pesos } from "./money";

describe("reports", () => {
  it("netProfit = income − expenses", () => {
    expect(netProfit(pesos(100_000), pesos(60_000))).toBe(pesos(40_000));
    expect(netProfit(pesos(50_000), pesos(80_000))).toBe(pesos(-30_000));
  });

  it("trial balance totals are balanced when debits equal credits", () => {
    const rows: TrialBalanceRow[] = [
      {
        accountCode: "1010",
        accountName: "Cash in Bank",
        accountType: "asset",
        debitCents: pesos(1000),
        creditCents: 0,
        balanceCents: pesos(1000),
      },
      {
        accountCode: "4000",
        accountName: "Service Revenue",
        accountType: "income",
        debitCents: 0,
        creditCents: pesos(1000),
        balanceCents: pesos(-1000),
      },
    ];
    const totals = trialBalanceTotals(rows);
    expect(totals.debitCents).toBe(pesos(1000));
    expect(totals.creditCents).toBe(pesos(1000));
    expect(totals.balanced).toBe(true);
  });

  it("detects an unbalanced trial balance", () => {
    const rows: TrialBalanceRow[] = [
      {
        accountCode: "1010",
        accountName: "Cash",
        accountType: "asset",
        debitCents: pesos(1000),
        creditCents: 0,
        balanceCents: pesos(1000),
      },
    ];
    expect(trialBalanceTotals(rows).balanced).toBe(false);
  });
});
