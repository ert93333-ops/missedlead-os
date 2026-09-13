import { type ReactNode, useEffect, useState } from "react";
import { type AuthValue, type Role } from "./auth";

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
    <section className="panel auth-card">
      <p className="eyebrow">WECOVER HOME REPAIR</p>
      <h1>Sign in to save<br/><em>your repair request.</em></h1>
      <p>{message}</p>
      <form onSubmit={(event) => { event.preventDefault(); const email = new FormData(event.currentTarget).get("email")?.toString() ?? ""; void signIn(email).then(() => setMessage("Check your email for the sign-in link.")).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Sign-in request failed.")); }}>
        <label>Email address<input name="email" type="email" required autoComplete="email" /></label>
        <button className="primary">Send sign-in link</button>
      </form>
      {auth.selectDemoActor && <div className="demo-actors" data-testid="demo-actor-selector"><strong>Demo access · local only</strong>{(["customer", "provider", "operator"] as const).map((role) => <button key={role} type="button" data-testid={`demo-${role}`} onClick={() => auth.selectDemoActor?.(role)}>{role}</button>)}</div>}
    </section>
  </main>;
}
