import { describe, it, expect } from "vitest";
import {
  normalBalanceFor,
  zAccountInput,
  DEFAULT_CHART_OF_ACCOUNTS,
  ACCOUNT_TYPES,
} from "./accounts";

describe("chart of accounts", () => {
  it("assigns the correct normal balance per type", () => {
    expect(normalBalanceFor("asset")).toBe("debit");
    expect(normalBalanceFor("expense")).toBe("debit");
    expect(normalBalanceFor("liability")).toBe("credit");
    expect(normalBalanceFor("equity")).toBe("credit");
    expect(normalBalanceFor("income")).toBe("credit");
  });

  it("validates account input", () => {
    expect(zAccountInput.safeParse({ code: "1000", name: "Cash", type: "asset" }).success).toBe(
      true,
    );
    expect(zAccountInput.safeParse({ code: "", name: "Cash", type: "asset" }).success).toBe(false);
    expect(zAccountInput.safeParse({ code: "10 00", name: "Cash", type: "asset" }).success).toBe(
      false,
    );
    expect(zAccountInput.safeParse({ code: "1000", name: "Cash", type: "bogus" }).success).toBe(
      false,
    );
  });

  it("default chart has unique names and only valid types", () => {
    // Codes intentionally repeat across types (real charts do); the key is name.
    const names = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const a of DEFAULT_CHART_OF_ACCOUNTS) {
      expect(ACCOUNT_TYPES).toContain(a.type);
      expect(["debit", "credit"]).toContain(a.normalBalance);
    }
  });

  it("every parentName resolves to another account in the chart", () => {
    const names = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.name));
    for (const a of DEFAULT_CHART_OF_ACCOUNTS) {
      if (a.parentName) expect(names.has(a.parentName)).toBe(true);
    }
  });
});
