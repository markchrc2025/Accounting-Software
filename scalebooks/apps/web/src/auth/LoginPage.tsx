import { useAuth } from "./AuthProvider";

export function LoginPage() {
  const { signInGoogle } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] font-sans">
      <div className="w-[360px] rounded-2xl border border-[#E5E7EB] bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">ScaleBooks</h1>
        <p className="mt-1 text-center text-sm text-[#6B7280]">Sign in to your finance portal.</p>
        <button
          onClick={signInGoogle}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1F2937] hover:bg-[#F9FAFB]"
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
