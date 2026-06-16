import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createContact,
  listContacts,
  type ContactType,
  type CreateContact,
} from "../lib/api";

const TYPES: ContactType[] = ["vendor", "customer", "employee"];

const emptyForm: CreateContact = { type: "vendor", name: "", tin: "", email: "", phone: "" };

export function ContactsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ContactType | "all">("all");
  const [form, setForm] = useState<CreateContact>(emptyForm);

  const contactsQ = useQuery({
    queryKey: ["contacts", filter],
    queryFn: () => listContacts(filter === "all" ? undefined : filter),
  });

  const mutation = useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      setForm(emptyForm);
    },
  });

  const inputCls =
    "h-9 rounded-lg border border-[#E5E7EB] px-2 text-sm focus:border-primary focus:outline-none";
  const set = (patch: Partial<CreateContact>) => setForm((f) => ({ ...f, ...patch }));
  const canSubmit = form.name.trim().length > 0;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
      <p className="mt-1 text-sm text-[#6B7280]">Vendors, customers, and employees.</p>

      {/* New contact */}
      <section className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">New contact</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Type
            <select
              className={inputCls}
              value={form.type}
              onChange={(e) => set({ type: e.target.value as ContactType })}
            >
              {TYPES.map((t) => (
                <option key={t} value={t} className="capitalize">
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Name
            <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            TIN
            <input className={inputCls} value={form.tin ?? ""} onChange={(e) => set({ tin: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Email
            <input className={inputCls} value={form.email ?? ""} onChange={(e) => set({ email: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Phone
            <input className={inputCls} value={form.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} />
          </label>
        </div>

        {mutation.isError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#DC2626]">
            {mutation.error instanceof ApiError ? mutation.error.detail : "Failed to save contact."}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit || mutation.isPending}
            onClick={() =>
              mutation.mutate({
                type: form.type,
                name: form.name.trim(),
                tin: form.tin || undefined,
                email: form.email || undefined,
                phone: form.phone || undefined,
              })
            }
          >
            {mutation.isPending ? "Saving…" : "Add contact"}
          </button>
        </div>
      </section>

      {/* List */}
      <section className="mt-8">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">All contacts</h2>
          <div className="ml-auto flex gap-1">
            {(["all", ...TYPES] as const).map((t) => (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                  filter === t ? "bg-primary-subtle text-primary" : "text-[#6B7280] hover:text-[#1F2937]"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          {contactsQ.isLoading ? (
            <p className="p-4 text-sm text-[#9CA3AF]">Loading…</p>
          ) : (contactsQ.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-[#9CA3AF]">No contacts yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F3F4F6] text-left text-[11px] uppercase tracking-wide text-[#9CA3AF]">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">TIN</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Phone</th>
                </tr>
              </thead>
              <tbody>
                {(contactsQ.data ?? []).map((ct) => (
                  <tr key={ct.id} className="border-b border-[#F3F4F6] last:border-0">
                    <td className="px-4 py-2 font-medium">{ct.name}</td>
                    <td className="px-4 py-2 capitalize text-[#6B7280]">{ct.type}</td>
                    <td className="px-4 py-2 text-[#6B7280]">{ct.tin ?? "—"}</td>
                    <td className="px-4 py-2 text-[#6B7280]">{ct.email ?? "—"}</td>
                    <td className="px-4 py-2 text-[#6B7280]">{ct.phone ?? "—"}</td>
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
