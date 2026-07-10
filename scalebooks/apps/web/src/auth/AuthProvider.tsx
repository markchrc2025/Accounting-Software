import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { setAccessToken, setTokenRefresher, getMe, ApiError } from "../lib/api";

/**
 * Auth + workspace state, backed by Authenticize via the OIDC Authorization Code
 * flow. Login is a full redirect handled by our API:
 *
 *   login()                → browser goes to <API>/auth/login
 *   API redirects to Authenticize, user signs in there, comes back to the API
 *   API hands us a JWT in the URL fragment (#token=…)
 *
 * We keep that token in memory (sessionStorage survives a refresh within the
 * tab) and send it as `Authorization: Bearer`. The API verifies it via
 * Authenticize's JWKS and admits the caller by email against the app_users
 * allowlist. No cross-domain cookies are involved, so this works across
 * separate *.sliplane.app hosts.
 *
 *   loading   → checking for a token (fragment or stored)
 *   anon      → no token; show the "Sign in with Sentire" screen
 *   verifying → have a token; confirming the workspace (GET /auth/me)
 *   ready     → verified; the app can render
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

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const TOKEN_KEY = "sb.token";

// Auth is on unless a dev user id is configured (local no-login bypass, paired
// with the API's AUTH_DEV_BYPASS).
export const authEnabled = !import.meta.env.VITE_DEV_USER_ID;

const readSS = (k: string): string | null => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeSS = (k: string, v: string | null) => {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    /* storage unavailable — ignore */
  }
};

/** Human-readable copy for the error codes the API callback can hand back. */
function mapCallbackError(code: string): string {
  switch (code) {
    case "management_account":
      return "That account manages Authenticize itself and can't sign in to an app. Use your Sentire Books account instead.";
    case "token_exchange_failed":
    case "token_unreachable":
      return "We couldn't complete sign-in with the identity provider. Please try again.";
    case "access_denied":
      return "Sign-in was cancelled.";
    default:
      return "Sign-in didn't complete. Please try again.";
  }
}

/** Send the browser through the API's OIDC login, returning here afterwards. */
function redirectToLogin(): void {
  const returnTo = window.location.pathname + window.location.search;
  window.location.href = `${API_BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

interface AuthState {
  session: AuthSession | null;
  phase: AuthPhase;
  org: OrgContext | null;
  authError: string | null;
  clearAuthError: () => void;
  login: () => void;
  signOut: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [phase, setPhase] = useState<AuthPhase>(authEnabled ? "loading" : "ready");
  const [org, setOrg] = useState<OrgContext | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!authEnabled || started.current) return;
    started.current = true;

    // On a 401, the token expired — bounce through the IdP (silent if the
    // Authenticize SSO session is still valid) and come back with a fresh one.
    setTokenRefresher(async () => {
      redirectToLogin();
      return null;
    });

    const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    const frag = new URLSearchParams(hash);
    const hashToken = frag.get("token");
    const hashError = frag.get("error");

    if (hashToken || hashError) {
      // Strip the fragment so the token/error doesn't linger in the URL bar.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }

    if (hashError) {
      setAuthError(mapCallbackError(hashError));
      setPhase("anon");
      return;
    }

    const token = hashToken ?? readSS(TOKEN_KEY);
    if (!token) {
      setPhase("anon");
      return;
    }
    writeSS(TOKEN_KEY, token);
    void verify(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function verify(token: string) {
    setAccessToken(token);
    setPhase("verifying");
    try {
      const me = await getMe();
      setSession({ user: me.user });
      setOrg({ id: me.org.id, name: me.org.name, code: me.org.code, role: me.role });
      setAuthError(null);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // Authenticated by Authenticize, but not on this workspace's allowlist.
        writeSS(TOKEN_KEY, null);
        setAccessToken(null);
        setAuthError(
          "Your account isn't on this workspace's user list yet. Ask your admin to add you.",
        );
        setPhase("anon");
      } else if (err instanceof ApiError && err.status === 401) {
        // Token rejected/expired and no silent path — start over.
        writeSS(TOKEN_KEY, null);
        setAccessToken(null);
        setPhase("anon");
      } else {
        // Transient (API unreachable) — keep the token, let the user retry.
        setAuthError("We couldn't reach the server. Check your connection and try again.");
        setPhase("anon");
      }
    }
  }

  const login = () => redirectToLogin();

  const signOut = () => {
    writeSS(TOKEN_KEY, null);
    setAccessToken(null);
    setSession(null);
    setOrg(null);
    window.location.href = `${API_BASE}/auth/logout`;
  };

  return (
    <Ctx.Provider
      value={{
        session,
        phase,
        org,
        authError,
        clearAuthError: () => setAuthError(null),
        login,
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
