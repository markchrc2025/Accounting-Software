import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, authEnabled } from "../lib/supabase";
import { setAccessToken } from "../lib/api";

interface AuthState {
  session: Session | null;
  loading: boolean;
  signInGoogle: () => void;
  signInPassword: (email: string, password: string) => Promise<{ error: string | null }>;
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

  const signInGoogle = () => {
    void supabase?.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  };

  const signInPassword = async (email: string, password: string) => {
    if (!supabase) return { error: "Auth is not configured." };
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setSession(null);
    setAccessToken(null);
  };

  return (
    <Ctx.Provider value={{ session, loading, signInGoogle, signInPassword, signOut }}>
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
