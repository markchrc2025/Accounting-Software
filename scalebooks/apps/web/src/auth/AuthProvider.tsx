import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, Provider } from "@supabase/supabase-js";
import { supabase, authEnabled } from "../lib/supabase";
import { setAccessToken, getMe } from "../lib/api";

/**
 * Auth + workspace state machine.
 *
 *   loading   → resolving the initial Supabase session
 *   anon      → no session; show the login screen
 *   verifying → have a session, confirming the entered company code matches the
 *               user's org (GET /auth/me)
 *   ready     → session verified; the app can render
 *
 * The company code (tenant ID) is required at login: sign-in stores the entered
 * code as `pending`, and once the session lands we compare it to the user's org.
 * A mismatch signs the user out and surfaces `authError`. Data isolation is still
 * enforced by RLS server-side — the code is the workspace gate, not a secret.
 */
export type AuthPhase = "loading" | "anon" | "verifying" | "ready";

export interface OrgContext {
  id: string;
  name: string;
  code: string;
  role: string;
}

const PENDING_KEY = "sb.pending_company";
const WORKSPACE_KEY = "sb.workspace";

const normCode = (c: string) => c.trim().toUpperCase();
const readLS = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLS = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage unavailable — ignore */
  }
};

interface AuthState {
  session: Session | null;
  phase: AuthPhase;
  org: OrgContext | null;
  authError: string | null;
  clearAuthError: () => void;
  signInPassword: (
    companyCode: string,
    email: string,
    password: string,
  ) => Promise<{ error: string | null; status: number | null }>;
  signInGoogle: (companyCode: string) => Promise<{ error: string | null }>;
  signInMicrosoft: (companyCode: string) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  // No IdP configured (local dev) → skip the gate entirely.
  const [phase, setPhase] = useState<AuthPhase>(authEnabled ? "loading" : "ready");
  const [org, setOrg] = useState<OrgContext | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  // Guards against overlapping verifications when the session changes rapidly.
  const verifyingToken = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => handleSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => handleSession(s));
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSession(s: Session | null) {
    setSession(s);
    setAccessToken(s?.access_token ?? null);

    if (!s) {
      setOrg(null);
      setPhase("anon");
      return;
    }

    // Verify the workspace for this session.
    const token = s.access_token;
    verifyingToken.current = token;
    setPhase("verifying");

    let me: Awaited<ReturnType<typeof getMe>> | null = null;
    try {
      me = await getMe();
    } catch {
      me = null;
    }
    if (verifyingToken.current !== token) return; // superseded by a newer session

    if (!me) {
      setAuthError("We couldn't load your workspace. Please try again.");
      await supabase!.auth.signOut();
      return;
    }

    const pending = readLS(PENDING_KEY);
    if (pending && normCode(pending) !== normCode(me.org.code)) {
      writeLS(PENDING_KEY, null);
      setAuthError(
        `This account isn't part of workspace "${normCode(pending)}". Check the company code or contact your admin.`,
      );
      await supabase!.auth.signOut(); // → handleSession(null) → anon, error stays
      return;
    }

    writeLS(PENDING_KEY, null);
    writeLS(WORKSPACE_KEY, me.org.code);
    setOrg({ id: me.org.id, name: me.org.name, code: me.org.code, role: me.role });
    setAuthError(null);
    setPhase("ready");
  }

  const startSignIn = (companyCode: string) => {
    setAuthError(null);
    writeLS(PENDING_KEY, normCode(companyCode));
  };

  const signInPassword = async (companyCode: string, email: string, password: string) => {
    if (!supabase) return { error: "Auth is not configured.", status: null };
    startSignIn(companyCode);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) writeLS(PENDING_KEY, null); // auth failed → nothing to verify
    return { error: error?.message ?? null, status: error?.status ?? null };
  };

  const signInOAuth = async (provider: Provider, companyCode: string) => {
    if (!supabase) return { error: "Auth is not configured." };
    startSignIn(companyCode);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) writeLS(PENDING_KEY, null);
    return { error: error?.message ?? null };
  };

  const signInGoogle = (companyCode: string) => signInOAuth("google", companyCode);
  const signInMicrosoft = (companyCode: string) => signInOAuth("azure", companyCode);

  const resetPassword = async (email: string) => {
    if (!supabase) return { error: "Auth is not configured." };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    writeLS(PENDING_KEY, null);
    await supabase?.auth.signOut();
    setSession(null);
    setOrg(null);
    setAccessToken(null);
    setPhase(authEnabled ? "anon" : "ready");
  };

  return (
    <Ctx.Provider
      value={{
        session,
        phase,
        org,
        authError,
        clearAuthError: () => setAuthError(null),
        signInPassword,
        signInGoogle,
        signInMicrosoft,
        resetPassword,
        signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export { authEnabled };
