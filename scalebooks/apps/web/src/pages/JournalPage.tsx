import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatPHP, isBalanced, parsePeso, sum } from "@scalebooks/domain";
import {
  ApiError,
  createJournalEntry,
  listAccounts,
  listJournalEntries,
  type CreateJournalLine,
} from "../lib/api";

interface FormLine {
  key: string;
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

const blankLine = (): FormLine => ({
  key: crypto.randomUUID(),
  accountId: "",
  debit: "",
  credit: "",
  description: "",
});

const today = () => new Date().toISOString().slice(0, 10);

export function JournalPage() {
  const qc = useQueryClient();
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });
  const entriesQ = useQuery({ queryKey: ["journal-entries"], queryFn: listJournalEntries });

  const [entryDate, setEntryDate] = useState(today());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<FormLine[]>([blankLine(), blankLine()]);

  const setLine = (key: string, patch: Partial<FormLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Convert form rows → centavo lines, dropping incomplete ones.
  const apiLines: CreateJournalLine[] = useMemo(
    () =>
      lines
        .map((l) => ({
          accountId: l.accountId,
          debitCents: parsePeso(l.debit) ?? 0,
          creditCents: parsePeso(l.credit) ?? 0,
          description: l.description || undefined,
        }))
        .filter((l) => l.accountId && (l.debitCents > 0 || l.creditCents > 0)),
    [lines],
  );

  const totalDebit = sum(apiLines.map((l) => l.debitCents));
  const totalCredit = sum(apiLines.map((l) => l.creditCents));
  const balanced = isBalanced(apiLines) && apiLines.length >= 2;

  const mutation = useMutation({
    mutationFn: createJournalEntry,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      setMemo("");
      setLines([blankLine(), blankLine()]);
      setEntryDate(today());
    },
  });

  const submit = () => {
    if (!balanced) return;
    mutation.mutate({ entryDate, memo: memo || undefined, lines: apiLines });
  };

  const inputCls =
    "h-9 rounded-lg border border-[#E5E7EB] px-2 text-sm focus:border-primary focus:outline-none";

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
      <p className="mt-1 text-sm text-[#6B7280]">
        Post balanced double-entry transactions. Debits must equal credits.
      </p>

      {/* New entry */}
      <section className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">
          New journal entry
        </h2>

        <div className="mt-4 flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Date
            <input
              type="date"
              className={inputCls}
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Memo
            <input
              className={inputCls}
              placeholder="e.g. Office supplies for June"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </label>
        </div>

        <table className="mt-4 w-full border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#9CA3AF]">
              <th className="font-medium">Account</th>
              <th className="font-medium">Description</th>
              <th className="w-32 text-right font-medium">Debit</th>
              <th className="w-32 text-right font-medium">Credit</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>
                  <select
                    className={`${inputCls} w-full`}
                    value={l.accountId}
                    onChange={(e) => setLine(l.key, { accountId: e.target.value })}
                    disabled={accountsQ.isLoading}
                  >
                    <option value="">— Select account —</option>
                    {(accountsQ.data ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className={`${inputCls} w-full`}
                    value={l.description}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={`${inputCls} w-full text-right`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={l.debit}
                    onChange={(e) => setLine(l.key, { debit: e.target.value, credit: "" })}
                  />
                </td>
                <td>
                  <input
                    className={`${inputCls} w-full text-right`}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={l.credit}
                    onChange={(e) => setLine(l.key, { credit: e.target.value, debit: "" })}
                  />
                </td>
                <td className="text-center">
                  {lines.length > 2 && (
                    <button
                      className="text-[#9CA3AF] hover:text-[#DC2626]"
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                      aria-label="Remove line"
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-2 flex items-center justify-between">
          <button
            className="text-sm font-medium text-primary hover:text-primary-hover"
            onClick={() => setLines((ls) => [...ls, blankLine()])}
          >
            + Add line
          </button>
          <div className="flex items-center gap-6 text-sm">
            <span>
              Debit <strong className="text-[#DC2626]">{formatPHP(totalDebit)}</strong>
            </span>
            <span>
              Credit <strong className="text-[#16A34A]">{formatPHP(totalCredit)}</strong>
            </span>
            <span className={balanced ? "text-[#16A34A]" : "text-[#D97706]"}>
              {balanced ? "✓ Balanced" : `Off by ${formatPHP(Math.abs(totalDebit - totalCredit))}`}
            </span>
          </div>
        </div>

        {mutation.isError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#DC2626]">
            {mutation.error instanceof ApiError
              ? mutation.error.detail
              : "Failed to post entry."}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!balanced || mutation.isPending}
            onClick={submit}
            title={balanced ? "" : "Balance debits and credits first"}
          >
            {mutation.isPending ? "Posting…" : "Post entry"}
          </button>
        </div>
      </section>

      {/* Recent entries */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">
          Recent entries
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          {entriesQ.isLoading ? (
            <p className="p-4 text-sm text-[#9CA3AF]">Loading…</p>
          ) : (entriesQ.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-[#9CA3AF]">No entries yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F3F4F6] text-left text-[11px] uppercase tracking-wide text-[#9CA3AF]">
                  <th className="px-4 py-2 font-medium">Entry No.</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Memo</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(entriesQ.data ?? []).map((e) => (
                  <tr key={e.id} className="border-b border-[#F3F4F6] last:border-0">
                    <td className="px-4 py-2 font-mono text-[13px]">{e.entryNo}</td>
                    <td className="px-4 py-2">{e.entryDate}</td>
                    <td className="px-4 py-2 text-[#6B7280]">{e.memo ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[11px] capitalize">
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
