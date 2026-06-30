import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, Provider } from "@supabase/supabase-js";
import { supabase, authEnabled } from "../lib/supabase";
import { setAccessToken } from "../lib/api";

/** Result of a credential sign-in. `status` is the IdP HTTP status (for lockout/rate-limit mapping). */
export interface SignInResult {
  error: string | null;
  status: number | null;
}

interface AuthState {
  session: Session | null;
  loading: boolean;
  signInGoogle: () => Promise<{ error: string | null }>;
  signInMicrosoft: () => Promise<{ error: string | null }>;
  signInPassword: (email: string, password: string) => Promise<SignInResult>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(authEnabled);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAccessToken(data.session?.access_token ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setAccessToken(s?.access_token ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // OAuth: on success the browser is redirected to the provider; an error
  // (e.g. the provider isn't enabled in Supabase) returns here without redirect.
  const signInOAuth = async (provider: Provider) => {
    if (!supabase) return { error: "Auth is not configured." };
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  };

  const signInGoogle = () => signInOAuth("google");
  const signInMicrosoft = () => signInOAuth("azure");

  const signInPassword = async (email: string, password: string): Promise<SignInResult> => {
    if (!supabase) return { error: "Auth is not configured.", status: null };
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error?.message ?? null, status: error?.status ?? null };
  };

  const resetPassword = async (email: string) => {
    if (!supabase) return { error: "Auth is not configured." };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setSession(null);
    setAccessToken(null);
  };

  return (
    <Ctx.Provider
      value={{
        session,
        loading,
        signInGoogle,
        signInMicrosoft,
        signInPassword,
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
