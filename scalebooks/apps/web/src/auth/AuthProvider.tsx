import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, Provider } from "@supabase/supabase-js";
import { supabase, authEnabled } from "../lib/supabase";
import { setAccessToken, getMe, ApiError } from "../lib/api";

/**
 * Auth + workspace state machine.
 *
 *   loading   → resolving the initial Supabase session
 *   anon      → no session; show the login screen
 *   verifying → have a session that needs (re-)resolving against the org — a
 *               fresh sign-in verifying the entered company code, or the very
 *               first resolution on page load. Blocks rendering the app.
 *   ready     → the org is resolved (or resolution failed transiently, see
 *               below) and the app can render.
 *
 * The company code (tenant ID) is required at login: sign-in stores the entered
 * code as `pending`, and once the session lands we compare it to the user's org.
 * A mismatch — or the server rejecting the token/user outright — signs the user
 * out. Anything else (a network blip, a cold-starting API) is treated as
 * transient: we do NOT tear down a valid session over it, we just leave `org`
 * unresolved for this render and let the next session event retry.
 *
 * Once an org is resolved for the current user, background session events
 * (token auto-refresh, tab refocus) update the token silently — they do NOT
 * re-run verification or drop back to the blocking "verifying" screen, so an
 * hourly token refresh can't unmount the app mid-work.
 *
 * Data isolation is enforced by Postgres RLS server-side regardless of any of
 * this — the company code is a workspace gate for UX, not a security boundary.
 */
export type AuthPhase = "loading" | "anon" | "verifying" | "ready";

export interface OrgContext {
  id: string;
  name: string;
  code: string;
  role: string;
}

const PENDING_KEY = "sb.pending_company";
const REMEMBER_KEY = "sb.pending_remember";
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
    remember: boolean,
  ) => Promise<{ error: string | null; status: number | null }>;
  signInGoogle: (companyCode: string, remember: boolean) => Promise<{ error: string | null }>;
  signInMicrosoft: (companyCode: string, remember: boolean) => Promise<{ error: string | null }>;
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

  // Refs mirror `org` / "which user we last resolved" so the onAuthStateChange
  // subscription (set up once, in a mount-time closure) always sees the latest
  // values instead of the stale ones captured at subscribe time.
  const orgRef = useRef<OrgContext | null>(null);
  const verifiedUserIdRef = useRef<string | null>(null);
  // Guards against a stale getMe() response landing after a newer session.
  const verifyingToken = useRef<string | null>(null);

  function updateOrg(next: OrgContext | null, userId: string | null) {
    orgRef.current = next;
    verifiedUserIdRef.current = userId;
    setOrg(next);
  }

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => void handleSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => void handleSession(s));
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSession(s: Session | null) {
    setSession(s);
    setAccessToken(s?.access_token ?? null);

    if (!s) {
      updateOrg(null, null);
      setPhase("anon");
      return;
    }

    const pending = readLS(PENDING_KEY);

    // Background refresh (token auto-refresh, tab refocus) of a session we've
    // already resolved for this same user, with nothing new to verify — update
    // the token (done above) and move on without touching the UI.
    if (!pending && orgRef.current && verifiedUserIdRef.current === s.user.id) {
      setPhase("ready");
      return;
    }

    const token = s.access_token;
    verifyingToken.current = token;
    setPhase("verifying");

    let me: Awaited<ReturnType<typeof getMe>> | null = null;
    let rejected = false; // server said "no" (bad/expired token, not provisioned) — not just unreachable
    try {
      me = await getMe();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) rejected = true;
      me = null;
    }
    if (verifyingToken.current !== token) return; // superseded by a newer session

    if (!me) {
      if (rejected) {
        writeLS(PENDING_KEY, null);
        writeLS(REMEMBER_KEY, null);
        setAuthError("We couldn't verify your account for this workspace. Please sign in again.");
        await supabase!.auth.signOut();
      } else {
        // Transient failure (network blip, API cold start) — keep the session
        // alive and let the app render; org info just isn't available yet. This
        // deliberately favors availability over re-attempting the company-code
        // check right now: RLS still scopes every query to the user's real org
        // regardless, so nothing is exposed by letting them in before a retry
        // confirms the code. `pending` is left set so the next session event
        // (retry, refresh) still runs the check once the API recovers.
        setPhase("ready");
      }
      return;
    }

    if (pending && normCode(pending) !== normCode(me.org.code)) {
      writeLS(PENDING_KEY, null);
      writeLS(REMEMBER_KEY, null);
      setAuthError(
        `This account isn't part of workspace "${normCode(pending)}". Check the company code or contact your admin.`,
      );
      await supabase!.auth.signOut(); // → handleSession(null) → anon, error stays
      return;
    }

    const remember = readLS(REMEMBER_KEY) !== "0";
    writeLS(PENDING_KEY, null);
    writeLS(REMEMBER_KEY, null);
    writeLS(WORKSPACE_KEY, remember ? me.org.code : null);

    updateOrg({ id: me.org.id, name: me.org.name, code: me.org.code, role: me.role }, s.user.id);
    setAuthError(null);
    setPhase("ready");
  }

  const startSignIn = (companyCode: string, remember: boolean) => {
    setAuthError(null);
    writeLS(PENDING_KEY, normCode(companyCode));
    writeLS(REMEMBER_KEY, remember ? "1" : "0");
  };

  const clearPendingSignIn = () => {
    writeLS(PENDING_KEY, null);
    writeLS(REMEMBER_KEY, null);
  };

  const signInPassword = async (
    companyCode: string,
    email: string,
    password: string,
    remember: boolean,
  ) => {
    if (!supabase) return { error: "Auth is not configured.", status: null };
    startSignIn(companyCode, remember);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) clearPendingSignIn(); // auth failed → nothing to verify
    return { error: error?.message ?? null, status: error?.status ?? null };
  };

  const signInOAuth = async (provider: Provider, companyCode: string, remember: boolean) => {
    if (!supabase) return { error: "Auth is not configured." };
    startSignIn(companyCode, remember);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) clearPendingSignIn();
    return { error: error?.message ?? null };
  };

  const signInGoogle = (companyCode: string, remember: boolean) =>
    signInOAuth("google", companyCode, remember);
  const signInMicrosoft = (companyCode: string, remember: boolean) =>
    signInOAuth("azure", companyCode, remember);

  const resetPassword = async (email: string) => {
    if (!supabase) return { error: "Auth is not configured." };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    clearPendingSignIn();
    await supabase?.auth.signOut();
    setSession(null);
    updateOrg(null, null);
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
