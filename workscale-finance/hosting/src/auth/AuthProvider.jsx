import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  setAccessToken,
  setActiveOrg,
  setTokenRefresher,
  getMe,
  listWorkspaces,
  signInWithPassword,
  ApiError,
} from '../lib/api.js';

/**
 * Auth + workspace state for the portal, backed by Authenticize (replacing
 * Firebase Auth). Password sign-in is proxied through our API; SSO/social go
 * through the OIDC redirect. A JWT is kept in sessionStorage and sent as Bearer;
 * the active workspace is sent as x-org-id. One identity may belong to several
 * workspaces — if so, we show a picker after login.
 *
 *   loading   → checking for a token (fragment or stored)
 *   anon      → no token; show the login screen
 *   choosing  → signed in, multiple workspaces, awaiting a pick
 *   verifying → confirming the chosen workspace (GET /auth/me)
 *   ready     → verified; the app can render
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';
const TOKEN_KEY = 'sb.token';
const ORG_KEY = 'sb.org';

const readSS = (k) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeSS = (k, v) => {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

function mapCallbackError(code) {
  switch (code) {
    case 'management_account':
      return "That account manages Authenticize itself and can't sign in to an app. Use your Sentire Books account instead.";
    case 'token_exchange_failed':
    case 'token_unreachable':
      return "We couldn't complete sign-in with the identity provider. Please try again.";
    case 'access_denied':
      return 'Sign-in was cancelled.';
    default:
      return "Sign-in didn't complete. Please try again.";
  }
}

function redirectToLogin() {
  const path = window.location.pathname + window.location.search;
  const returnTo = path.startsWith('/login') || path.startsWith('/auth') ? '/' : path;
  window.location.href = `${API_BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [org, setOrg] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [authError, setAuthError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    setTokenRefresher(async () => {
      redirectToLogin();
      return null;
    });

    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
    const frag = new URLSearchParams(hash);
    const hashToken = frag.get('token');
    const hashError = frag.get('error');

    if (hashToken || hashError) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    if (hashError) {
      setAuthError(mapCallbackError(hashError));
      setPhase('anon');
      return;
    }
    const token = hashToken ?? readSS(TOKEN_KEY);
    if (!token) {
      setPhase('anon');
      return;
    }
    writeSS(TOKEN_KEY, token);
    void resolveWorkspaces(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resolveWorkspaces(token, preferredCode) {
    setAccessToken(token);
    setPhase('verifying');
    try {
      const { workspaces: list } = await listWorkspaces();
      setWorkspaces(list);

      if (list.length === 0) {
        writeSS(TOKEN_KEY, null);
        setAccessToken(null);
        setAuthError("Your account isn't on any workspace's user list yet. Ask your admin to add you.");
        setPhase('anon');
        return;
      }
      if (preferredCode) {
        const match = list.find((w) => w.code.toLowerCase() === preferredCode.toLowerCase());
        if (!match) {
          writeSS(TOKEN_KEY, null);
          setAccessToken(null);
          setAuthError(`This account isn't in workspace "${preferredCode.toUpperCase()}".`);
          setPhase('anon');
          return;
        }
        await enter(match.id);
        return;
      }
      if (list.length === 1) {
        await enter(list[0].id);
        return;
      }
      const remembered = readSS(ORG_KEY);
      if (remembered && list.some((w) => w.id === remembered)) await enter(remembered);
      else setPhase('choosing');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        writeSS(TOKEN_KEY, null);
        setAccessToken(null);
        setPhase('anon');
      } else {
        setAuthError("We couldn't reach the server. Check your connection and try again.");
        setPhase('anon');
      }
    }
  }

  async function enter(orgId) {
    setActiveOrg(orgId);
    writeSS(ORG_KEY, orgId);
    setPhase('verifying');
    try {
      const me = await getMe();
      setSession({ user: me.user });
      setOrg({ id: me.org.id, name: me.org.name, code: me.org.code, role: me.role });
      setAuthError(null);
      setPhase('ready');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        writeSS(ORG_KEY, null);
        setActiveOrg(null);
        if (err.status === 401) {
          writeSS(TOKEN_KEY, null);
          setAccessToken(null);
          setPhase('anon');
        } else {
          setAuthError("You don't have access to that workspace.");
          setPhase('choosing');
        }
      } else {
        setAuthError("We couldn't reach the server. Check your connection and try again.");
        setPhase('anon');
      }
    }
  }

  const login = () => redirectToLogin();

  const signInPassword = async (email, password, companyCode) => {
    setAuthError(null);
    try {
      const { token } = await signInWithPassword(email.trim(), password);
      writeSS(TOKEN_KEY, token);
      await resolveWorkspaces(token, companyCode ? companyCode.trim() : undefined);
      return { error: null };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return { error: 'invalid_credentials' };
      return { error: 'network' };
    }
  };

  const chooseWorkspace = (orgId) => {
    setAuthError(null);
    void enter(orgId);
  };

  const switchWorkspace = () => {
    setActiveOrg(null);
    writeSS(ORG_KEY, null);
    setOrg(null);
    setAuthError(null);
    setPhase('choosing');
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

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
