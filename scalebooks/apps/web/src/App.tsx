import { formatPHP, pesos, computeAnnualTax } from "@scalebooks/domain";

/**
 * Placeholder shell. The real UI is ported module-by-module from the existing
 * React app (workscale-finance/hosting/src) — re-typed and pointed at the API
 * instead of writing to Firestore directly. This page just proves the shared
 * @scalebooks/domain money + tax logic is wired across the workspace boundary.
 */
export function App() {
  const sampleTax = computeAnnualTax(pesos(500_000));
  return (
    <main className="mx-auto max-w-2xl p-8 font-sans text-[#1F2937]">
      <h1 className="text-3xl font-medium tracking-tight">ScaleBooks</h1>
      <p className="mt-2 text-sm text-[#6B7280]">
        Clean foundation — Postgres + TypeScript monorepo.
      </p>

      <div className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
          Shared domain check
        </div>
        <p className="mt-2 text-sm">
          Money formatting: <strong>{formatPHP(pesos(1234.56))}</strong>
        </p>
        <p className="mt-1 text-sm">
          TRAIN tax on ₱500,000 taxable: <strong>{formatPHP(sampleTax)}</strong>
        </p>
      </div>
    </main>
  );
}
