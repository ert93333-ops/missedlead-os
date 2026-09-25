/**
 * Supabase Auth 래퍼. 세션을 감시하고 actor(id/email/role)와 accessToken을 제공한다.
 * 역할은 session.user.app_metadata.role에서 읽는다(없으면 customer).
 * 공개 호스트(터널 등)에서는 loopback Supabase URL 대신 same-origin /supa 프록시를 사용한다.
 * password 있으면 signInWithPassword, 없으면 매직링크(OTP). quickDemoLogin은 dev/데모 빌드 전용.
 */
import { createClient, type Session } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useMemo, useState } from "react";

export type Role = "customer" | "provider" | "operator";
export type Actor = { id: string; email?: string; role: Role };
export type AuthValue = {
  actor: Actor | null;
  accessToken: string | null;
  loading: boolean;
  signIn: (email: string, password?: string) => Promise<void>;
  signOut: () => Promise<void>;
  quickDemoLogin?: (role: Role) => Promise<void>;
};

const roles = new Set<Role>(["customer", "provider", "operator"]);
const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
// A loopback Supabase URL is unreachable when the app is served from a public
// host (tunnels, phones, other devices); route through the same-origin /supa
// proxy instead.
const onLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const isLoopback = envUrl !== undefined && /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(envUrl);
const url = envUrl && isLoopback && !onLocalHost ? `${window.location.origin}/supa` : envUrl;
const supabase = url && key ? createClient(url, key) : null;
const demoAuthEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_AUTH === "true";

function actorFromSession(session: Session | null): Actor | null {
  if (!session) return null;
  const explicitRole = session.user.app_metadata?.role;
  const role = explicitRole === undefined || explicitRole === null ? "customer" : explicitRole;
  return roles.has(role as Role) ? { id: session.user.id, email: session.user.email, role: role as Role } : null;
}

/** Demo sessions are visual-only; src/app/demo.ts decides when they may run offline. */
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
    signIn: async (email, password) => {
      if (!supabase) throw new Error("Supabase environment configuration is required.");
      if (password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
    },
    signOut: async () => { setDemo(null); if (supabase) await supabase.auth.signOut(); },
    quickDemoLogin: demoAuthEnabled ? async (role) => setDemo(demoSession(role)) : undefined,
  }), [demo, loading, session]);

  return <>{children(value)}</>;
}
