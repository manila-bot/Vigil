import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ThreatOrb } from "@/components/vigil/ThreatOrb";
import { actions, roleLabel, USERS } from "@/lib/vigil";
import { api, session, USE_MOCKS } from "@/lib/api";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Sign in — Vigil" },
      { name: "description", content: "Sign in to Vigil, the ransomware response command center for law firms." },
      { property: "og:title", content: "Sign in — Vigil" },
      { property: "og:description", content: "Secure access for counsel and IT responders." },
    ],
  }),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState(USE_MOCKS ? USERS[0]?.email ?? "" : "");
  const [pw, setPw] = useState(USE_MOCKS ? "demo" : "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return setErr("Enter your password.");
    setErr(""); setBusy(true);
    try {
      if (USE_MOCKS) { if (!actions.signIn(email)) throw new Error("No active account for that email."); }
      else {
        const login = await api.login(email.trim(), pw);
        session.set(login.token, login.user);
      }
      await nav({ to: "/" });
    } catch (error) { setErr(error instanceof Error ? error.message : "Unable to sign in."); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden border-r bg-panel p-12 lg:flex">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">Harlow & Reed LLP · Est. 1987</div>
        <div className="flex flex-col items-start gap-8">
          <ThreatOrb attack={false} size={260} />
          <h1 className="max-w-md text-5xl leading-[1.05]">Your matters stay on schedule, even under attack.</h1>
          <p className="max-w-md text-muted-foreground">Vigil watches every system your counsel relies on and turns an incident into a clear, owned recovery plan.</p>
        </div>
        <div className="text-xs text-muted-foreground">Privileged & confidential · Attorney work product</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="text-3xl">Sign in</h2>
            <p className="mt-1 text-sm text-muted-foreground">{USE_MOCKS ? "Sample mode — any password works." : "Use your Vigil account. Vigil has its own sign-in, separate from firm email."}</p>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="username" className="w-full rounded-md border bg-input/30 px-3 py-2 outline-none focus:border-ring" />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span>Password</span>
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" required autoComplete="current-password" className="w-full rounded-md border bg-input/30 px-3 py-2 outline-none focus:border-ring" />
          </label>
          {err && <p role="alert" className="text-sm text-threat">{err}</p>}
          <Button disabled={busy} className="w-full">{busy ? "Signing in…" : "Sign in"}</Button>
          {USE_MOCKS && <div className="space-y-1 border-t pt-4 text-xs text-muted-foreground">
            <div className="font-mono uppercase tracking-widest">Demo accounts</div>
            {USERS.map((u) => (
              <Button variant="ghost" size="sm" type="button" key={u.id} onClick={() => setEmail(u.email)} className="flex h-auto w-full justify-start whitespace-normal text-left">
                {u.email} — {roleLabel(u.role)}
              </Button>
            ))}
          </div>}
        </form>
      </div>
    </div>
  );
}
