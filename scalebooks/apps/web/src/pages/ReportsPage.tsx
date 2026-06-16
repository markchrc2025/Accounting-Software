import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatPHP } from "@scalebooks/domain";
import { getProfitAndLoss, getTrialBalance, type Period } from "../lib/api";

export function ReportsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const period: Period = { from: from || undefined, to: to || undefined };

  const tbQ = useQuery({
    queryKey: ["trial-balance", from, to],
    queryFn: () => getTrialBalance(period),
  });
  const pnlQ = useQuery({
    queryKey: ["profit-and-loss", from, to],
    queryFn: () => getProfitAndLoss(period),
  });

  const inputCls =
    "h-9 rounded-lg border border-[#E5E7EB] px-2 text-sm focus:border-primary focus:outline-none";
  const periodLabel = from || to ? `${from || "start"} → ${to || "today"}` : "All time";

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <p className="mt-1 text-sm text-[#6B7280]">
        Trial balance and profit &amp; loss, computed in SQL from posted entries.
      </p>

      {/* Period filter */}
      <div className="mt-6 flex flex-wrap items-end gap-4 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
          From
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
          To
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button
          className="h-9 rounded-lg border border-[#E5E7EB] px-3 text-sm font-medium text-[#6B7280] hover:border-primary hover:text-primary"
          onClick={() => {
            setFrom("");
            setTo("");
          }}
        >
          Clear
        </button>
        <span className="ml-auto text-sm text-[#9CA3AF]">Period: {periodLabel}</span>
      </div>

      {/* Profit & Loss */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Profit &amp; loss</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Metric label="Income" value={pnlQ.data ? formatPHP(pnlQ.data.incomeCents) : "—"} />
          <Metric label="Expenses" value={pnlQ.data ? formatPHP(pnlQ.data.expenseCents) : "—"} />
          <Metric
            label="Net profit"
            value={pnlQ.data ? formatPHP(pnlQ.data.netProfitCents) : "—"}
            tone={pnlQ.data ? (pnlQ.data.netProfitCents >= 0 ? "positive" : "negative") : "neutral"}
          />
        </div>
      </section>

      {/* Trial balance */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Trial balance</h2>
          {tbQ.data &&
            (tbQ.data.balanced ? (
              <span className="text-sm text-[#16A34A]">✓ Balanced</span>
            ) : (
              <span className="text-sm text-[#DC2626]">⚠ Out of balance</span>
            ))}
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          {tbQ.isLoading ? (
            <p className="p-4 text-sm text-[#9CA3AF]">Loading…</p>
          ) : tbQ.isError ? (
            <p className="p-4 text-sm text-[#DC2626]">Failed to load report.</p>
          ) : (tbQ.data?.rows ?? []).length === 0 ? (
            <p className="p-4 text-sm text-[#9CA3AF]">No posted entries in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F3F4F6] text-left text-[11px] uppercase tracking-wide text-[#9CA3AF]">
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 text-right font-medium">Debit</th>
                  <th className="px-4 py-2 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {tbQ.data!.rows.map((r) => (
                  <tr key={r.accountCode} className="border-b border-[#F3F4F6] last:border-0">
                    <td className="px-4 py-2 font-mono text-[13px]">{r.accountCode}</td>
                    <td className="px-4 py-2">{r.accountName}</td>
                    <td className="px-4 py-2 text-right">
                      {r.debitCents ? formatPHP(r.debitCents) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {r.creditCents ? formatPHP(r.creditCents) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#E5E7EB] font-semibold">
                  <td className="px-4 py-2" colSpan={2}>
                    Total
                  </td>
                  <td className="px-4 py-2 text-right text-[#DC2626]">
                    {formatPHP(tbQ.data!.totals.debitCents)}
                  </td>
                  <td className="px-4 py-2 text-right text-[#16A34A]">
                    {formatPHP(tbQ.data!.totals.creditCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const color =
    tone === "positive" ? "text-[#16A34A]" : tone === "negative" ? "text-[#DC2626]" : "text-[#1F2937]";
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
