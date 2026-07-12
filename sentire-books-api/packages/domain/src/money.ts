/**
 * Money is represented as an INTEGER number of centavos (1 peso = 100 centavos).
 *
 * Why: the old codebase summed `parseFloat(x)` floats, so 0.1 + 0.2 drifted and
 * trial balances diverged by a centavo over time. Integers never drift.
 *
 * Range: JS safe integers reach 2^53 ≈ ₱90 trillion in centavos — far beyond any
 * realistic ledger total — so a `number` is safe here. In Postgres these are
 * stored as `bigint`.
 */

/** A whole number of centavos. Negative is allowed (contra / reversals). */
export type Centavos = number;

export class MoneyError extends Error {}

/** Build centavos from a peso amount (e.g. pesos(1234.56) -> 123456). */
export function pesos(amount: number): Centavos {
  if (!Number.isFinite(amount)) throw new MoneyError(`Not a finite amount: ${amount}`);
  // Round to the nearest centavo to absorb float input like 1234.561.
  return Math.round(amount * 100);
}

/** Parse user/string input into centavos. Returns null on anything invalid —
 *  callers must handle null instead of silently coercing bad input to 0. */
export function parsePeso(input: string | number | null | undefined): Centavos | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim().replace(/[₱,\s]/g, "");
  if (raw === "" || !/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Assert a value is a valid centavo integer (used at trust boundaries). */
export function assertCentavos(v: unknown): asserts v is Centavos {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new MoneyError(`Amount must be an integer number of centavos, got: ${String(v)}`);
  }
  if (!Number.isSafeInteger(v)) {
    throw new MoneyError(`Amount exceeds the safe integer range: ${v}`);
  }
}

export function toPesos(c: Centavos): number {
  return c / 100;
}

export const ZERO: Centavos = 0;

export function add(a: Centavos, b: Centavos): Centavos {
  return a + b;
}

export function sub(a: Centavos, b: Centavos): Centavos {
  return a - b;
}

export function neg(a: Centavos): Centavos {
  return -a;
}

export function sum(values: readonly Centavos[]): Centavos {
  return values.reduce((acc, v) => acc + v, 0);
}

export function isZero(a: Centavos): boolean {
  return a === 0;
}

const PHP = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format centavos as e.g. "₱1,234.56". Privacy mode masks the digits. */
export function formatPHP(c: Centavos, opts?: { privacy?: boolean }): string {
  if (opts?.privacy) return "₱••••";
  return PHP.format(c / 100);
}
