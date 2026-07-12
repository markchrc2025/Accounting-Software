import { describe, it, expect } from "vitest";
import { pesos, parsePeso, sum, formatPHP, toPesos, assertCentavos, MoneyError } from "./money";

describe("money — integer centavos", () => {
  it("never drifts like floats (the 0.1 + 0.2 problem)", () => {
    // Float math: 0.1 + 0.2 === 0.30000000000000004
    expect(sum([pesos(0.1), pesos(0.2)])).toBe(30); // exactly 30 centavos
    expect(toPesos(sum([pesos(0.1), pesos(0.2)]))).toBe(0.3);
  });

  it("sums thousands of lines without rounding error", () => {
    const lines = Array.from({ length: 10_000 }, () => pesos(0.01));
    expect(sum(lines)).toBe(10_000); // ₱100.00 exactly
  });

  it("pesos() rounds to the nearest centavo", () => {
    expect(pesos(1234.561)).toBe(123456);
    expect(pesos(1234.565)).toBe(123457);
  });

  it("parsePeso() returns null on bad input instead of coercing to 0", () => {
    expect(parsePeso("1,234.56")).toBe(123456);
    expect(parsePeso("₱ 1,000")).toBe(100000);
    expect(parsePeso("")).toBeNull();
    expect(parsePeso("abc")).toBeNull();
    expect(parsePeso(undefined)).toBeNull();
  });

  it("assertCentavos rejects non-integers", () => {
    expect(() => assertCentavos(12.5)).toThrow(MoneyError);
    expect(() => assertCentavos(12)).not.toThrow();
  });

  it("formats PHP and supports privacy mode", () => {
    expect(formatPHP(123456)).toBe("₱1,234.56");
    expect(formatPHP(123456, { privacy: true })).toBe("₱••••");
  });
});
