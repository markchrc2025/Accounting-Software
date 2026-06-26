import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

export function LoginPage() {
  const { signInGoogle, signInPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await signInPassword(email, password);
    setBusy(false);
    if (error) setError(error);
    // On success, the auth state listener swaps this page for the app.
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] font-sans">
      <div className="w-[360px] rounded-2xl border border-[#E5E7EB] bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">ScaleBooks</h1>
        <p className="mt-1 text-center text-sm text-[#6B7280]">Sign in to your finance portal.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-3">
          <div>
            <label className="block text-xs font-medium text-[#6B7280]">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-[#E5E7EB] px-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#6B7280]">Password</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-[#E5E7EB] px-3 text-sm outline-none focus:border-primary"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs text-[#B91C1C]">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-[#9CA3AF]">
          <span className="h-px flex-1 bg-[#E5E7EB]" />
          or
          <span className="h-px flex-1 bg-[#E5E7EB]" />
        </div>

        <button
          onClick={signInGoogle}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1F2937] hover:bg-[#F9FAFB]"
        >
          <span className="text-base">G</span>
          Continue with Google
        </button>

        <p className="mt-4 text-center text-xs text-[#9CA3AF]">
          Access is granted by your administrator.
        </p>
      </div>
    </div>
  );
}
