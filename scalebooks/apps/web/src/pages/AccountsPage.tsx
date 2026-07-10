import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, importAccounts, listAccounts } from "../lib/api";
import { parseCoaFile, type ParsedCoa } from "../lib/coaImport";
import { authEnabled, useAuth } from "../auth/AuthProvider";

export function AccountsPage() {
  const qc = useQueryClient();
  const { org } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedCoa | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseErr, setParseErr] = useState<string | null>(null);

  // Import is admin-only server-side; in local dev-bypass there's no org, so allow it.
  const canImport = !authEnabled || org?.role === "admin";

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: listAccounts });

  const mutation = useMutation({
    mutationFn: () => importAccounts(parsed?.accounts ?? []),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setParsed(null);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
    },
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseErr(null);
    mutation.reset();
    setFileName(file.name);
    try {
      setParsed(await parseCoaFile(file));
    } catch {
      setParsed(null);
      setParseErr("Couldn't read that file. Make sure it's a valid .xlsx export.");
    }
  }

  const withParents = parsed?.accounts.filter((a) => a.parentName).length ?? 0;
  const result = mutation.data;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Chart of Accounts</h1>
      <p className="mt-1 text-sm text-[#6B7280]">
        Import your accounts from an Excel export (Zoho format), then use them across journals and
        vouchers.
      </p>

      {/* Import */}
      {canImport && (
        <section className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">
            Import from Excel
          </h2>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-9 rounded-lg border border-[#E5E7EB] px-4 text-sm font-medium hover:bg-[#F9FAFB]"
            >
              Choose .xlsx file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => void onFile(e)}
            />
            {fileName && <span className="text-sm text-[#6B7280]">{fileName}</span>}
          </div>

          {parseErr && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#DC2626]">{parseErr}</p>
          )}

          {parsed && (
            <div className="mt-4">
              <p className="text-sm text-[#374151]">
                Found <b>{parsed.accounts.length}</b> accounts
                {withParents > 0 && <> ({withParents} with a parent)</>}
                {parsed.skipped > 0 && (
                  <span className="text-[#9CA3AF]"> · {parsed.skipped} rows skipped (no name/type)</span>
                )}
                .
              </p>
              <div className="mt-3 max-h-52 overflow-auto rounded-lg border border-[#F3F4F6]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-[#F3F4F6] text-left text-[11px] uppercase tracking-wide text-[#9CA3AF]">
                      <th className="px-3 py-2 font-medium">Code</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Parent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.accounts.slice(0, 12).map((a, i) => (
                      <tr key={i} className="border-b border-[#F3F4F6] last:border-0">
                        <td className="px-3 py-1.5 text-[#6B7280]">{a.code || "—"}</td>
                        <td className="px-3 py-1.5 font-medium">{a.name}</td>
                        <td className="px-3 py-1.5 capitalize text-[#6B7280]">{a.type}</td>
                        <td className="px-3 py-1.5 text-[#6B7280]">{a.parentName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsed.accounts.length > 12 && (
                <p className="mt-1 text-xs text-[#9CA3AF]">…and {parsed.accounts.length - 12} more.</p>
              )}

              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  disabled={parsed.accounts.length === 0 || mutation.isPending}
                  onClick={() => mutation.mutate()}
                  className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mutation.isPending ? "Importing…" : `Import ${parsed.accounts.length} accounts`}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setParsed(null);
                    setFileName("");
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  className="text-sm text-[#6B7280] hover:text-[#1F2937]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mutation.isError && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#DC2626]">
              {mutation.error instanceof ApiError ? mutation.error.detail : "Import failed."}
            </p>
          )}
          {result && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Imported {result.inserted} account{result.inserted === 1 ? "" : "s"}
              {result.skipped > 0 && <> · {result.skipped} already existed</>}
              {result.linked > 0 && <> · {result.linked} parent links</>}.
            </p>
          )}
        </section>
      )}

      {/* List */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">
          Accounts {accountsQ.data ? `(${accountsQ.data.length})` : ""}
        </h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          {accountsQ.isLoading ? (
            <p className="p-4 text-sm text-[#9CA3AF]">Loading…</p>
          ) : (accountsQ.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-[#9CA3AF]">
              No accounts yet. Import your chart from an Excel file above.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F3F4F6] text-left text-[11px] uppercase tracking-wide text-[#9CA3AF]">
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Subtype</th>
                </tr>
              </thead>
              <tbody>
                {(accountsQ.data ?? []).map((a) => (
                  <tr key={a.id} className="border-b border-[#F3F4F6] last:border-0">
                    <td className="px-4 py-2 text-[#6B7280]">{a.code || "—"}</td>
                    <td className="px-4 py-2 font-medium">{a.name}</td>
                    <td className="px-4 py-2 capitalize text-[#6B7280]">{a.type}</td>
                    <td className="px-4 py-2 text-[#6B7280]">{a.subtype ?? "—"}</td>
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
