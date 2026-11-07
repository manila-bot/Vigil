import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { post, session, USE_MOCKS } from "../api/client";
import { ErrorBanner } from "../components/ui";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState(USE_MOCKS ? "responder@vigil.local" : "");
  const [password, setPassword] = useState(USE_MOCKS ? "sample" : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post("/auth/login", { email, password });
      session.set(r.token, r.user);
      nav("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <ShieldCheck className="h-9 w-9 text-navy-700" />
          <div>
            <h1 className="text-2xl font-bold text-navy-900">Vigil</h1>
            <p className="text-sm text-slate-500">Incident command center</p>
          </div>
        </div>
        <ErrorBanner message={error} />
        <label className="label" htmlFor="email">Email</label>
        <input id="email" className="input mb-4" type="email" autoComplete="username" autoFocus required
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="label" htmlFor="password">Password</label>
        <input id="password" className="input mb-6" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn-primary w-full justify-center py-3" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="mt-6 text-xs leading-relaxed text-slate-500">
          Vigil uses its own accounts, separate from firm email and single sign-on. Use the Vigil credentials your
          incident admin gave you.
        </p>
      </form>
    </div>
  );
}
