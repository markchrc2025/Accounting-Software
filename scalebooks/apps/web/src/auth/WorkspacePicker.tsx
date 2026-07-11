import { useAuth } from "./AuthProvider";

/**
 * Shown after sign-in when the identity belongs to more than one workspace
 * (e.g. a bookkeeper serving several clients). Picking one scopes the whole app
 * to that org; it's remembered for next time and can be changed from the nav.
 */
export function WorkspacePicker() {
  const { workspaces, chooseWorkspace, signOut, session, authError } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-6 font-sans text-[#1F2937]">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Choose a workspace</h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            {session?.user?.email
              ? `Signed in as ${session.user.email}. `
              : ""}
            You have access to {workspaces.length} workspaces.
          </p>
        </div>

        {authError && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-[#DC2626]">{authError}</p>
        )}

        <ul className="space-y-2">
          {workspaces.map((w) => (
            <li key={w.id}>
              <button
                onClick={() => chooseWorkspace(w.id)}
                className="flex w-full items-center justify-between rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 text-left shadow-sm transition hover:border-primary hover:shadow"
              >
                <span>
                  <span className="block text-sm font-semibold">{w.name}</span>
                  <span className="block text-xs text-[#9CA3AF]">{w.code}</span>
                </span>
                <span className="rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-medium capitalize text-primary">
                  {w.role}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-6 text-center">
          <button
            onClick={() => signOut()}
            className="text-sm font-medium text-[#6B7280] hover:text-[#1F2937]"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
