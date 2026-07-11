import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  setAccessToken,
  setActiveOrg,
  setTokenRefresher,
  getMe,
  listWorkspaces,
  signInWithPassword,
  ApiError,
  type WorkspaceDto,
} from "../lib/api";

/**
 * Auth + workspace state, backed by Authenticize via the OIDC Authorization Code
 * flow. Login is a full redirect handled by our API (see src/oidc.ts):
 *
 *   login()  → <API>/auth/login → Authenticize → back with a JWT in the fragment
 *
 * We keep that token in sessionStorage and send it as `Authorization: Bearer`.
 * Because one identity can belong to several workspaces (a bookkeeper serving
 * many clients), after the token lands we list the caller's workspaces:
 *   - exactly one  → enter it automatically
 *   - more than one → show a picker (phase "choosing")
 * The chosen workspace is sent as `x-org-id` on every request and remembered.
 *
 *   loading   → checking for a token
 *   anon      → no token; show "Sign in with Sentire"
 *   choosing  → signed in, multiple workspaces, waiting for a pick
 *   verifying → confirming the chosen workspace (GET /auth/me)
 *   ready     → verified; the app can render
 */
export type AuthPhase = "loading" | "anon" | "choosing" | "verifying" | "ready";

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
const ORG_KEY = "sb.org";

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
  workspaces: WorkspaceDto[];
  authError: string | null;
  clearAuthError: () => void;
  login: () => void;
  signInPassword: (
    companyCode: string,
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  chooseWorkspace: (orgId: string) => void;
  switchWorkspace: () => void;
  signOut: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [phase, setPhase] = useState<AuthPhase>(authEnabled ? "loading" : "ready");
  const [org, setOrg] = useState<OrgContext | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceDto[]>([]);
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
    void resolveWorkspaces(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * With a valid token, decide which workspace to enter. `preferredCode` is the
   * company code from the password form: when given we go straight to that
   * workspace (and error if the account isn't in it); when absent we auto-enter a
   * lone workspace or show the picker.
   */
  async function resolveWorkspaces(token: string, preferredCode?: string) {
    setAccessToken(token);
    setPhase("verifying");
    try {
      const { workspaces: list } = await listWorkspaces();
      setWorkspaces(list);

      if (list.length === 0) {
        writeSS(TOKEN_KEY, null);
        setAccessToken(null);
        setAuthError(
          "Your account isn't on any workspace's user list yet. Ask your admin to add you.",
        );
        setPhase("anon");
        return;
      }

      if (preferredCode) {
        const match = list.find((w) => w.code.toLowerCase() === preferredCode.toLowerCase());
        if (!match) {
          writeSS(TOKEN_KEY, null);
          setAccessToken(null);
          setAuthError(
            `This account isn't in workspace "${preferredCode.toUpperCase()}". Check the company code or contact your admin.`,
          );
          setPhase("anon");
          return;
        }
        await enter(match.id);
        return;
      }

      if (list.length === 1) {
        await enter(list[0]!.id);
        return;
      }
      // Multiple workspaces — reuse a remembered choice, else ask.
      const remembered = readSS(ORG_KEY);
      if (remembered && list.some((w) => w.id === remembered)) {
        await enter(remembered);
      } else {
        setPhase("choosing");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        writeSS(TOKEN_KEY, null);
        setAccessToken(null);
        setPhase("anon");
      } else {
        setAuthError("We couldn't reach the server. Check your connection and try again.");
        setPhase("anon");
      }
    }
  }

  /** Activate a workspace and confirm it server-side. */
  async function enter(orgId: string) {
    setActiveOrg(orgId);
    writeSS(ORG_KEY, orgId);
    setPhase("verifying");
    try {
      const me = await getMe();
      setSession({ user: me.user });
      setOrg({ id: me.org.id, name: me.org.name, code: me.org.code, role: me.role });
      setAuthError(null);
      setPhase("ready");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        // Token expired, or no access to this workspace — start over.
        writeSS(ORG_KEY, null);
        setActiveOrg(null);
        if (err.status === 401) {
          writeSS(TOKEN_KEY, null);
          setAccessToken(null);
          setPhase("anon");
        } else {
          setAuthError("You don't have access to that workspace.");
          setPhase("choosing");
        }
      } else {
        setAuthError("We couldn't reach the server. Check your connection and try again.");
        setPhase("anon");
      }
    }
  }

  const login = () => redirectToLogin();

  /** In-app email/password sign-in; the company code picks the workspace. */
  const signInPassword = async (companyCode: string, email: string, password: string) => {
    setAuthError(null);
    try {
      const { token } = await signInWithPassword(email.trim(), password);
      writeSS(TOKEN_KEY, token);
      await resolveWorkspaces(token, companyCode.trim() || undefined);
      return { error: null };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        return { error: "invalid_credentials" };
      }
      return { error: "network" };
    }
  };

  const chooseWorkspace = (orgId: string) => {
    setAuthError(null);
    void enter(orgId);
  };

  const switchWorkspace = () => {
    setActiveOrg(null);
    writeSS(ORG_KEY, null);
    setOrg(null);
    setAuthError(null);
    setPhase("choosing");
  };

  const signOut = () => {
    writeSS(TOKEN_KEY, null);
    writeSS(ORG_KEY, null);
    setAccessToken(null);
    setActiveOrg(null);
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
        workspaces,
        authError,
        clearAuthError: () => setAuthError(null),
        login,
        signInPassword,
        chooseWorkspace,
        switchWorkspace,
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
