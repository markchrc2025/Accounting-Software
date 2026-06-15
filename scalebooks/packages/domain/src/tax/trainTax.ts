/**
 * Philippine TRAIN-law annual income tax (BIR, 2023-onward graduated table).
 * Ported from the legacy GAS `_computeTrainTax_` so it can be unit-tested.
 *
 * All amounts are in CENTAVOS (integers). Brackets are expressed in centavos.
 *
 *   Annual taxable income          Tax
 *   ────────────────────────────   ──────────────────────────────────────────
 *   ≤ ₱250,000                      0
 *   ₱250,000 – ₱400,000            15% of excess over ₱250,000
 *   ₱400,000 – ₱800,000            ₱22,500 + 20% of excess over ₱400,000
 *   ₱800,000 – ₱2,000,000          ₱102,500 + 25% of excess over ₱800,000
 *   ₱2,000,000 – ₱8,000,000        ₱402,500 + 30% of excess over ₱2,000,000
 *   > ₱8,000,000                    ₱2,202,500 + 35% of excess over ₱8,000,000
 */
import type { Centavos } from "../money";

interface Bracket {
  /** Lower bound of the bracket, in centavos (inclusive). */
  floor: Centavos;
  /** Cumulative base tax at `floor`, in centavos. */
  baseTax: Centavos;
  /** Marginal rate applied to (income − floor). */
  rate: number;
}

// ₱ → centavos
const C = (peso: number): Centavos => peso * 100;

const BRACKETS: readonly Bracket[] = [
  { floor: C(250_000), baseTax: C(0), rate: 0.15 },
  { floor: C(400_000), baseTax: C(22_500), rate: 0.2 },
  { floor: C(800_000), baseTax: C(102_500), rate: 0.25 },
  { floor: C(2_000_000), baseTax: C(402_500), rate: 0.3 },
  { floor: C(8_000_000), baseTax: C(2_202_500), rate: 0.35 },
];

/**
 * Compute annual income tax due (centavos) for a given annual taxable income.
 * Income at or below ₱250,000 is exempt.
 */
export function computeAnnualTax(annualTaxableCentavos: Centavos): Centavos {
  if (!Number.isInteger(annualTaxableCentavos)) {
    throw new Error("annualTaxableCentavos must be an integer (centavos)");
  }
  if (annualTaxableCentavos <= C(250_000)) return 0;

  // Find the highest bracket whose floor the income reaches.
  let applicable = BRACKETS[0]!;
  for (const b of BRACKETS) {
    if (annualTaxableCentavos > b.floor) applicable = b;
    else break;
  }

  const excess = annualTaxableCentavos - applicable.floor;
  return Math.round(applicable.baseTax + excess * applicable.rate);
}

/** Minimum-wage earners (MWE) are exempt from income tax under the TRAIN law. */
export function computeAnnualTaxForEmployee(args: {
  annualTaxableCentavos: Centavos;
  isMWE: boolean;
}): Centavos {
  if (args.isMWE) return 0;
  return computeAnnualTax(args.annualTaxableCentavos);
}
