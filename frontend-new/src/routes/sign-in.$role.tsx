import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ROLE_INFO, signIn, useVigil, type Role } from "@/lib/vigil-store";
import { Btn } from "@/components/vigil-ui";
import { RadarShield } from "@/components/RadarShield";

const DEST = { lawyer: "/lawyer", it: "/it", admin: "/admin" } as const;

export const Route = createFileRoute("/sign-in/$role")({
  beforeLoad: ({ params }) => {
    if (!Object.hasOwn(ROLE_INFO, params.role)) throw notFound();
  },
  head: ({ params }) => {
    const t = ROLE_INFO[params.role as Role]?.title ?? "Sign in";
    return {
      meta: [
        { title: `${t} sign in — Vigil` },
        { name: "description", content: `Sign in to Vigil as ${t}.` },
        { property: "og:title", content: `${t} sign in — Vigil` },
        { property: "og:description", content: `Sign in to Vigil as ${t}.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: SignIn,
});

const inputCls =
  "w-full border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary";

function SignIn() {
  const { role } = Route.useParams() as { role: Role };
  const info = ROLE_INFO[role];
  const v = useVigil();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto grid max-w-5xl overflow-hidden border md:grid-cols-2">
      <div className="p-8 md:p-12">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">
          Vigil · secure sign in
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{info.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to continue to your {info.title.toLowerCase()} view.
        </p>
        <form
          className="mt-8 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await signIn(role, email.trim(), pw);
              await navigate({ to: DEST[role] });
            } catch (error) {
              setError(error instanceof Error ? error.message : "Sign-in failed.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Work email
            </span>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className={inputCls}
            />
          </label>
          <Btn type="submit" disabled={busy} className="w-full py-2.5">
            Sign in
          </Btn>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </form>
      </div>
      <div className="relative hidden min-h-[420px] border-l bg-card/40 md:block">
        <RadarShield underAttack={Boolean(v.detail)} />
      </div>
    </div>
  );
}
