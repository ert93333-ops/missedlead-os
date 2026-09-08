import { createClient, type Session } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useMemo, useState } from "react";

export type Role = "customer" | "provider" | "operator";
export type Actor = { id: string; email?: string; role: Role };
export type AuthValue = {
  actor: Actor | null;
  accessToken: string | null;
  loading: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectDemoActor?: (role: Role) => void;
};

const roles = new Set<Role>(["customer", "provider", "operator"]);
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = url && key ? createClient(url, key) : null;
const demoAuthEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_AUTH === "true";

function actorFromSession(session: Session | null): Actor | null {
  if (!session) return null;
  const explicitRole = session.user.app_metadata?.role;
  const role = explicitRole === undefined || explicitRole === null ? "customer" : explicitRole;
  return roles.has(role as Role) ? { id: session.user.id, email: session.user.email, role: role as Role } : null;
}

function demoSession(role: Role): { actor: Actor; accessToken: string } {
  const payload = btoa(JSON.stringify({ sub: `demo-${role}`, email: `${role}@demo.wecover.local`, app_metadata: { role } })).replaceAll("=", "");
  return { actor: { id: `demo-${role}`, email: `${role}@demo.wecover.local`, role }, accessToken: `demo.${payload}.session` };
}

export function AuthProvider({ children }: { children: (auth: AuthValue) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [demo, setDemo] = useState<ReturnType<typeof demoSession> | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setLoading(false); });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthValue>(() => ({
    actor: demo?.actor ?? actorFromSession(session),
    accessToken: demo?.accessToken ?? session?.access_token ?? null,
    loading,
    signIn: async (email) => {
      if (!supabase) throw new Error("Supabase 환경 설정이 필요합니다.");
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
    },
    signOut: async () => { setDemo(null); if (supabase) await supabase.auth.signOut(); },
    selectDemoActor: demoAuthEnabled ? (role) => setDemo(demoSession(role)) : undefined,
  }), [demo, loading, session]);

  return <>{children(value)}</>;
}
