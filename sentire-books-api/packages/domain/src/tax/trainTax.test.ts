import { describe, it, expect } from "vitest";
import { computeAnnualTax, computeAnnualTaxForEmployee } from "./trainTax";
import { pesos } from "../money";

describe("TRAIN annual income tax", () => {
  it("exempts income at or below ₱250,000", () => {
    expect(computeAnnualTax(pesos(0))).toBe(0);
    expect(computeAnnualTax(pesos(250_000))).toBe(0);
  });

  it("matches the BIR bracket boundaries (cumulative base tax)", () => {
    expect(computeAnnualTax(pesos(400_000))).toBe(pesos(22_500));
    expect(computeAnnualTax(pesos(800_000))).toBe(pesos(102_500));
    expect(computeAnnualTax(pesos(2_000_000))).toBe(pesos(402_500));
    expect(computeAnnualTax(pesos(8_000_000))).toBe(pesos(2_202_500));
  });

  it("applies the marginal rate within a bracket", () => {
    // ₱500,000 → 22,500 + 20% of (500,000 − 400,000) = 42,500
    expect(computeAnnualTax(pesos(500_000))).toBe(pesos(42_500));
    // ₱10,000,000 → 2,202,500 + 35% of (10,000,000 − 8,000,000) = 2,902,500
    expect(computeAnnualTax(pesos(10_000_000))).toBe(pesos(2_902_500));
  });

  it("exempts minimum-wage earners regardless of amount", () => {
    expect(
      computeAnnualTaxForEmployee({ annualTaxableCentavos: pesos(500_000), isMWE: true }),
    ).toBe(0);
  });
});
