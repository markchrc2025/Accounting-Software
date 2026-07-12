import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  setAccessToken,
  setActiveOrg,
  getMe,
  listWorkspaces,
  signInWithPassword,
  ApiError,
  type WorkspaceDto,
} from "../lib/api";

/**
 * Auth + workspace state. Sign-in is email/password against Sentire Books' own
 * API (POST /auth/password), which returns a short-lived Books access token.
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

interface AuthState {
  session: AuthSession | null;
  phase: AuthPhase;
  org: OrgContext | null;
  workspaces: WorkspaceDto[];
  authError: string | null;
  clearAuthError: () => void;
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

    // Resume a stored session if there's a token; otherwise show the login.
    // The token is short-lived — on expiry a request 401s and we drop to anon
    // (the login screen), where the user signs in again.
    const token = readSS(TOKEN_KEY);
    if (!token) {
      setPhase("anon");
      return;
    }
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
    setAuthError(null);
    setPhase("anon");
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
