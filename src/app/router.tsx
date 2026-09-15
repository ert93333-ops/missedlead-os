/**
 * 역할 라우터 + 로그인 게이트. /customer·/provider·/operator 경로와 actor.role을 맞춘다.
 * 미인증이면 AuthGate(이메일/비밀번호 로그인 폼 + 신뢰 문구 + dev 데모 선택기)를 렌더링.
 */
import { type ReactNode, useEffect, useState } from "react";
import { type AuthValue, type Role } from "./auth";
import { LockIcon, MessageIcon, ReceiptIcon, ShieldCheckIcon } from "./icons";


const paths: Record<Role, string> = { customer: "/customer", provider: "/provider", operator: "/operator" };

function currentPath() { return window.location.pathname; }

function roleForPath(path: string): Role | null {
  if (path === paths.customer) return "customer";
  if (path === paths.provider) return "provider";
  if (path === paths.operator) return "operator";
  return null;
}

export function RoleRouter({ auth, render }: { auth: AuthValue; render: (role: Role) => ReactNode }) {
  const { actor, loading } = auth;
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const update = () => setPath(currentPath());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  useEffect(() => {
    if (!actor) return;
    const expected = paths[actor.role];
    if (path !== expected) {
      window.history.replaceState(null, "", expected);
      setPath(expected);
    }
  }, [actor, path]);

  if (loading) return <main className="auth-screen" data-testid="auth-loading">Checking your session…</main>;
  if (!actor) return <AuthGate auth={auth} />;
  if (roleForPath(path) !== actor.role) return <main className="auth-screen" data-testid="role-redirect">Redirecting to your workspace…</main>;
  return <>{render(actor.role)}</>;
}

function AuthGate({ auth }: { auth: AuthValue }) {
  const { signIn } = auth;
  const [message, setMessage] = useState("Enter your email and we’ll send you a secure sign-in link.");
  return <main className="auth-screen" data-testid="auth-gate">
    <div className="auth-split">
    <aside className="auth-scene" aria-hidden="true">
      <img className="auth-scene__img" src="/img/login-hero.png" alt=""/>
      <div className="auth-scene__caption"><strong>Charlotte pilot</strong><span>Licensed pros · county permits verified · deposit protection</span></div>
    </aside>
    <section className="panel auth-card">
      <p className="eyebrow">WECOVER HOME REPAIR</p>
      <h1>Sign in to save<br/><em>your repair request.</em></h1>
      <p>{message}</p>
      <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const email = form.get("email")?.toString() ?? ""; const password = form.get("password")?.toString() ?? ""; void signIn(email, password || undefined).then(() => setMessage(password ? "Signing you in…" : "Check your email for the sign-in link.")).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Sign-in request failed.")); }}>
        <label>Email address<input name="email" type="email" required autoComplete="email" /></label>
        <label>Password <span className="auth-hint">leave blank for a sign-in link</span><input name="password" type="password" autoComplete="current-password" /></label>
        <button className="primary">Sign in</button>
      </form>
      <ul className="auth-trust">
        <li><ShieldCheckIcon size={15}/>Licensed and insured local pros, verified by our operations team</li>
        <li><ReceiptIcon size={15}/>Itemized quotes compared side by side — not just the cheapest</li>
        <li><LockIcon size={15}/>20% deposit and a 72-hour review window before final payment</li>
        <li><MessageIcon size={15}/>Bilingual support — English and Spanish</li>
      </ul>
      {auth.selectDemoActor && <div className="demo-actors" data-testid="demo-actor-selector"><strong>Demo access · local only</strong>{(["customer", "provider", "operator"] as const).map((role) => <button key={role} type="button" data-testid={`demo-${role}`} onClick={() => auth.selectDemoActor?.(role)}>{role}</button>)}</div>}
    </section>
    </div>
  </main>;
}
