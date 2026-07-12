import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { USER_ROLES, type UserRoleName } from "@scalebooks/domain";
import { ApiError, inviteUser, listUsers, setUserPassword } from "../lib/api";
import { useAuth } from "../auth/AuthProvider";

export function UsersPage() {
  const qc = useQueryClient();
  const { org } = useAuth();
  const isAdmin = org?.role === "admin";

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRoleName>("maker");
  // Which user's password is being set inline, and the value being typed.
  const [pwEdit, setPwEdit] = useState<{ id: string; value: string } | null>(null);

  const usersQ = useQuery({ queryKey: ["users"], queryFn: listUsers, enabled: isAdmin });

  const mutation = useMutation({
    mutationFn: () =>
      inviteUser({ email: email.trim(), role, fullName: fullName.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEmail("");
      setFullName("");
      setRole("maker");
    },
  });

  const pwMutation = useMutation({
    mutationFn: (vars: { id: string; password: string }) =>
      setUserPassword(vars.id, vars.password),
    onSuccess: () => setPwEdit(null),
  });

  const inputCls =
    "h-9 rounded-lg border border-[#E5E7EB] px-2 text-sm focus:border-primary focus:outline-none";
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-5xl p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-2 text-sm text-[#6B7280]">Only workspace admins can manage users.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-[#6B7280]">
        Add people by email and role, then set each person a password. Only emails on this list are
        admitted to the workspace.
      </p>

      {/* Invite */}
      <section className="mt-6 rounded-xl border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">Invite a user</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280] sm:col-span-1">
            Work email
            <input
              className={inputCls}
              type="email"
              placeholder="person@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Full name (optional)
            <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-[#6B7280]">
            Role
            <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as UserRoleName)}>
              {USER_ROLES.map((r) => (
                <option key={r} value={r} className="capitalize">
                  {r}
                </option>
              ))}
            </select>
          </label>
        </div>

        {mutation.isError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#DC2626]">
            {mutation.error instanceof ApiError ? mutation.error.detail : "Failed to invite user."}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!emailOk || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Adding…" : "Add user"}
          </button>
        </div>
      </section>

      {/* List */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280]">
          Allowlist {usersQ.data ? `(${usersQ.data.length})` : ""}
        </h2>
        {pwMutation.isError && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#DC2626]">
            {pwMutation.error instanceof ApiError ? pwMutation.error.detail : "Failed to set password."}
          </p>
        )}
        <div className="mt-3 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          {usersQ.isLoading ? (
            <p className="p-4 text-sm text-[#9CA3AF]">Loading…</p>
          ) : (usersQ.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-[#9CA3AF]">No users yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F3F4F6] text-left text-[11px] uppercase tracking-wide text-[#9CA3AF]">
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Password</th>
                </tr>
              </thead>
              <tbody>
                {(usersQ.data ?? []).map((u) => (
                  <tr key={u.id} className="border-b border-[#F3F4F6] last:border-0">
                    <td className="px-4 py-2 font-medium">{u.email}</td>
                    <td className="px-4 py-2 text-[#6B7280]">{u.fullName ?? "—"}</td>
                    <td className="px-4 py-2 capitalize text-[#6B7280]">{u.role}</td>
                    <td className="px-4 py-2">
                      {pwEdit?.id === u.id ? (
                        <span className="flex items-center gap-2">
                          <input
                            type="password"
                            autoFocus
                            className={inputCls + " h-8"}
                            placeholder="New password (min 8)"
                            value={pwEdit.value}
                            onChange={(e) => setPwEdit({ id: u.id, value: e.target.value })}
                          />
                          <button
                            className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50"
                            disabled={pwEdit.value.length < 8 || pwMutation.isPending}
                            onClick={() => pwMutation.mutate({ id: u.id, password: pwEdit.value })}
                          >
                            {pwMutation.isPending ? "Saving…" : "Save"}
                          </button>
                          <button
                            className="h-8 rounded-lg px-2 text-xs text-[#6B7280]"
                            onClick={() => setPwEdit(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          className="h-8 rounded-lg border border-[#E5E7EB] px-3 text-xs font-medium text-[#374151] hover:bg-[#F9FAFB]"
                          onClick={() => setPwEdit({ id: u.id, value: "" })}
                        >
                          Set password
                        </button>
                      )}
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
