import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatPHP, parsePeso, sum } from "@scalebooks/domain";
import {
  ApiError,
  createVoucher,
  listAccounts,
  listContacts,
  listVouchers,
  type CreateVoucherLine,
  type VoucherType,
} from "../lib/api";

interface FormLine {
  key: string;
  accountId: string;
  description: string;
  amount: string;
}

const blankLine = (): FormLine => ({
  key: crypto.randomUUID(),
  accountId: "",
  description: "",
  amount: "",
});

const today = () => new Date().toISOString().slice(0, 10);

export function VouchersPage() {
  const qc = useQueryClient();
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });
  const contactsQ = useQuery({ queryKey: ["contacts", "all"], queryFn: () => listContacts() });
  const vouchersQ = useQuery({ queryKey: ["vouchers"], queryFn: listVouchers });

  const [type, setType] = useState<VoucherType>("payment");
  const [contactId, setContactId] = useState("");
  const [voucherDate, setVoucherDate] = useState(today());
  const [cashAccountId, setCashAccountId] = useState("");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<FormLine[]>([blankLine()]);

  const setLine = (key: string, patch: Partial<FormLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const apiLines: CreateVoucherLine[] = useMemo(
    () =>
      lines
        .map((l) => ({
          accountId: l.accountId,
          description: l.description || undefined,
          amountCents: parsePeso(l.amount) ?? 0,
        }))
        .filter((l) => l.accountId && l.amountCents > 0),
    [lines],
  );

  const total = sum(apiLines.map((l) => l.amountCents));
  const canSubmit = cashAccountId !== "" && apiLines.length >= 1 && total > 0;

  const mutation = useMutation({
    mutationFn: createVoucher,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vouchers"] });
      qc.invalidateQueries({ queryKey: ["journal-entries"] });
      setMemo("");
      setContactId("");
      setLines([blankLine()]);
      setVoucherDate(today());
    },
  });

  const submit = () => {
    if (!canSubmit) return;
    mutation.mutate({
      type,
      contactId: contactId || undefined,
      voucherDate,
      memo: memo || undefined,
      cashAccountId,
      lines: apiLines,
    });
  };

  const inputCls =
    "h-9 rounded-lg border border-[#E5E7EB] px-2 text-sm focus:border-primary focus:outline-none";
  const detailLabel = type === "payment" ? "Expense / debit account" : "Income / credit account";
  const cashLabel = type === "payment" ? "Paid from (cash/bank)" : "Received into (cash/bank)";

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Vouchers</h1>
      <p className="mt-1 text-sm text-[#6B7280]">
        Payments and receipts. Each voucher posts a balanced journal entry atomically.
      </p>

      {/* New voucher */}
      <section className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">New voucher</h2>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Type
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as VoucherType)}>
              <option value="payment">Payment</option>
              <option value="receipt">Receipt</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Date
            <input type="date" className={inputCls} value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Contact
            <select className={inputCls} value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">— None —</option>
              {(contactsQ.data ?? []).map((ct) => (
                <option key={ct.id} value={ct.id}>
                  {ct.name} ({ct.type})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            {cashLabel}
            <select className={inputCls} value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
              <option value="">— Select account —</option>
              {(accountsQ.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
          Memo
          <input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>

        <table className="mt-4 w-full border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#9CA3AF]">
              <th className="font-medium">{detailLabel}</th>
              <th className="font-medium">Description</th>
              <th className="w-36 text-right font-medium">Amount</th>
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
                    value={l.amount}
                    onChange={(e) => setLine(l.key, { amount: e.target.value })}
                  />
                </td>
                <td className="text-center">
                  {lines.length > 1 && (
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
          <span className="text-sm">
            Total <strong>{formatPHP(total)}</strong>
          </span>
        </div>

        {mutation.isError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#DC2626]">
            {mutation.error instanceof ApiError ? mutation.error.detail : "Failed to post voucher."}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit || mutation.isPending}
            onClick={submit}
          >
            {mutation.isPending ? "Posting…" : "Post voucher"}
          </button>
        </div>
      </section>

      {/* Recent vouchers */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Recent vouchers</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          {vouchersQ.isLoading ? (
            <p className="p-4 text-sm text-[#9CA3AF]">Loading…</p>
          ) : (vouchersQ.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-[#9CA3AF]">No vouchers yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F3F4F6] text-left text-[11px] uppercase tracking-wide text-[#9CA3AF]">
                  <th className="px-4 py-2 font-medium">Voucher No.</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Contact</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(vouchersQ.data ?? []).map((v) => (
                  <tr key={v.id} className="border-b border-[#F3F4F6] last:border-0">
                    <td className="px-4 py-2 font-mono text-[13px]">{v.voucherNo}</td>
                    <td className="px-4 py-2">{v.voucherDate}</td>
                    <td className="px-4 py-2 capitalize text-[#6B7280]">{v.voucherType}</td>
                    <td className="px-4 py-2 text-[#6B7280]">{v.contactName ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{formatPHP(v.totalCents)}</td>
                    <td className="px-4 py-2">
                      <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[11px] capitalize">
                        {v.status}
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
