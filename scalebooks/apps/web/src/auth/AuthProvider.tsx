import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authClient, authEnabled, AUTH_URL } from "../lib/authClient";
import { setAccessToken, setTokenRefresher, getMe, ApiError } from "../lib/api";

/**
 * Auth + workspace state machine, backed by Authenticize (Better Auth / OIDC).
 *
 *   loading   → resolving the initial session
 *   anon      → no session; show the login screen
 *   verifying → have a session; fetching a JWT for our API and confirming the
 *               entered company code matches the user's org (GET /auth/me)
 *   ready     → verified; the app can render
 *
 * Login talks to Authenticize with the Better Auth client (email/password +
 * Google). Better Auth uses a session cookie; for our Bearer-token API we then
 * fetch a signed JWT from Authenticize's `/api/auth/token` endpoint and send it
 * as `Authorization: Bearer`. The API verifies it via Authenticize's JWKS.
 *
 * The company code (tenant ID) is required at login: sign-in stores the entered
 * code as `pending`, and once the session lands we compare it to the resolved
 * org. A mismatch — or the API rejecting the token — signs the user out. Data
 * isolation is enforced by Postgres RLS regardless; the code is a UX gate.
 */
export type AuthPhase = "loading" | "anon" | "verifying" | "ready";

export interface OrgContext {
  id: string;
  name: string;
  code: string;
  role: string;
}

export interface AuthSession {
  user: { id: string; email: string };
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

/** Exchange the Authenticize session cookie for a JWT our API can verify. */
async function fetchApiToken(): Promise<string | null> {
  if (!AUTH_URL) return null;
  try {
    const res = await fetch(`${AUTH_URL}/api/auth/token`, { credentials: "include" });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string };
    return body.token ?? null;
  } catch {
    return null;
  }
}

interface AuthState {
  session: AuthSession | null;
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
  signUp: (
    companyCode: string,
    email: string,
    password: string,
    fullName: string,
    remember: boolean,
  ) => Promise<{ error: string | null; status: number | null }>;
  signInGoogle: (companyCode: string, remember: boolean) => Promise<{ error: string | null }>;
  signInMicrosoft: (companyCode: string, remember: boolean) => Promise<{ error: string | null }>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [phase, setPhase] = useState<AuthPhase>(authEnabled ? "loading" : "ready");
  const [org, setOrg] = useState<OrgContext | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const verifySeq = useRef(0);

  useEffect(() => {
    if (!authClient) return;
    void establishSession();
    // Re-fetch a fresh JWT whenever an API call 401s (the Better Auth session
    // cookie outlives the short-lived JWT, so this is a silent refresh).
    setTokenRefresher(fetchApiToken);
    return () => setTokenRefresher(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function establishSession() {
    if (!authClient) return;
    try {
      const { data } = await authClient.getSession();
      const user = data?.user;
      await handleSession(user ? { user: { id: user.id, email: user.email ?? "" } } : null);
    } catch {
      // Identity provider unreachable on load — fall back to the login screen
      // rather than hanging on the splash.
      await handleSession(null);
    }
  }

  async function forceSignedOut(message: string | null) {
    try {
      await authClient?.signOut();
    } catch {
      /* best-effort — force local state regardless */
    }
    writeLS(PENDING_KEY, null);
    writeLS(REMEMBER_KEY, null);
    setSession(null);
    setOrg(null);
    setAccessToken(null);
    if (message) setAuthError(message);
    setPhase("anon");
  }

  async function handleSession(next: AuthSession | null) {
    if (!next) {
      setSession(null);
      setOrg(null);
      setAccessToken(null);
      setPhase("anon");
      return;
    }
    setSession(next);
    const seq = ++verifySeq.current;
    setPhase("verifying");

    const token = await fetchApiToken();
    if (verifySeq.current !== seq) return;
    if (!token) {
      // Signed in with Authenticize but couldn't obtain an API token — without
      // it the app can't call the API at all, so sign out and let them retry.
      await forceSignedOut("We couldn't establish your session. Please try again.");
      return;
    }
    setAccessToken(token);

    let me: Awaited<ReturnType<typeof getMe>> | null = null;
    let rejected = false; // API said no (bad token / not provisioned) — not just unreachable
    try {
      me = await getMe();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) rejected = true;
      me = null;
    }
    if (verifySeq.current !== seq) return;

    if (!me) {
      if (rejected) {
        await forceSignedOut("We couldn't verify your account for this workspace. Please sign in again.");
      } else {
        // Transient failure (API blip) — keep the session, render the app; RLS
        // still scopes data. The next request retries the workspace check.
        setPhase("ready");
      }
      return;
    }

    const pending = readLS(PENDING_KEY);
    if (pending && normCode(pending) !== normCode(me.org.code)) {
      await forceSignedOut(
        `This account isn't part of workspace "${normCode(pending)}". Check the company code or contact your admin.`,
      );
      return;
    }

    const remember = readLS(REMEMBER_KEY) !== "0";
    writeLS(PENDING_KEY, null);
    writeLS(REMEMBER_KEY, null);
    writeLS(WORKSPACE_KEY, remember ? me.org.code : null);

    setOrg({ id: me.org.id, name: me.org.name, code: me.org.code, role: me.role });
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
    if (!authClient) return { error: "Auth is not configured.", status: null };
    startSignIn(companyCode, remember);
    const { error } = await authClient.signIn.email({
      email: email.trim(),
      password,
      rememberMe: remember,
    });
    if (error) {
      clearPendingSignIn();
      return { error: error.message ?? "Sign in failed.", status: error.status ?? null };
    }
    await establishSession(); // sets phase → verifying → ready (or signs out on mismatch)
    return { error: null, status: null };
  };

  // Self-signup: the user creates their own credentials on Authenticize. Sentire
  // still admits them only if an admin put their email on the workspace allowlist
  // (get_user_context by email) — Authenticize authenticates, Sentire authorizes.
  const signUp = async (
    companyCode: string,
    email: string,
    password: string,
    fullName: string,
    remember: boolean,
  ) => {
    if (!authClient) return { error: "Auth is not configured.", status: null };
    startSignIn(companyCode, remember);
    const { error } = await authClient.signUp.email({
      email: email.trim(),
      password,
      name: fullName.trim() || email.trim(),
    });
    if (error) {
      clearPendingSignIn();
      return { error: error.message ?? "Sign up failed.", status: error.status ?? null };
    }
    await establishSession(); // creates a session; workspace check gates admission
    return { error: null, status: null };
  };

  const signInSocial = async (
    provider: "google" | "microsoft",
    companyCode: string,
    remember: boolean,
  ) => {
    if (!authClient) return { error: "Auth is not configured." };
    startSignIn(companyCode, remember);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: window.location.origin,
    });
    if (error) {
      clearPendingSignIn();
      return { error: error.message ?? null };
    }
    return { error: null }; // success → browser is redirected to the provider
  };

  const signInGoogle = (companyCode: string, remember: boolean) =>
    signInSocial("google", companyCode, remember);
  const signInMicrosoft = (companyCode: string, remember: boolean) =>
    signInSocial("microsoft", companyCode, remember);

  const resetPassword = async (email: string) => {
    if (!AUTH_URL) return { error: "Auth is not configured." };
    try {
      const res = await fetch(`${AUTH_URL}/api/auth/request-password-reset`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          redirectTo: `${window.location.origin}/reset-password`,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        return { error: body?.message ?? "Couldn't send the reset email." };
      }
      return { error: null };
    } catch {
      return { error: "Couldn't reach the server. Check your connection and try again." };
    }
  };

  const signOut = async () => {
    await forceSignedOut(null);
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
        signUp,
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
