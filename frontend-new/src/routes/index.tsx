import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RadarShield } from "@/components/RadarShield";

import { Sparkline } from "@/components/Sparkline";
import { useVigil } from "@/lib/vigil-store";
import { Panel } from "@/components/vigil-ui";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vigil — Keep Legal Work Moving During a Cyberattack" },
      {
        name: "description",
        content:
          "Vigil lets lawyers request critical files during a cyberattack while IT routes, claims and completes the work.",
      },
      { property: "og:title", content: "Vigil — Keep Legal Work Moving During a Cyberattack" },
      {
        property: "og:description",
        content:
          "Lawyers, Help Desk and Technical IT follow the same request from start to finish.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Overview,
});

const ROLES = [
  {
    role: "lawyer",
    to: "/lawyer",
    n: "01",
    t: "Lawyer",
    d: "Request the files you need to keep a filing on schedule.",
  },
  {
    role: "it",
    to: "/it",
    n: "02",
    t: "IT Help Desk & Technical IT",
    d: "Follow Photon alerts, claim requests, and mark recovery work complete.",
  },
  {
    role: "admin",
    to: "/admin",
    n: "03",
    t: "Admin",
    d: "One view of the IT team, the incident and full activity history.",
  },
] as const;

function Overview() {
  const v = useVigil();
  const active = Boolean(v.detail);
  const [demoScan, setDemoScan] = useState<"ready" | "scanning" | "alert">("ready");
  const radarAlert = active || demoScan === "alert";

  useEffect(() => {
    if (demoScan !== "scanning") return;
    const timer = window.setTimeout(() => setDemoScan("alert"), 10_000);
    return () => window.clearTimeout(timer);
  }, [demoScan]);

  const open = v.detail?.requests.filter((r) => r.status !== "done").length ?? 0;
  const unowned =
    v.detail?.requests.filter((r) => !r.owner_user_id && r.status !== "done").length ?? 0;

  return (
    <div className="space-y-5" data-radar-alert={radarAlert ? "" : undefined}>
      {radarAlert && <div aria-hidden="true" className="radar-screen-alert" />}
      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col justify-center">
          <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">
            Systems go down.
            <br />
            <span className={active ? "text-destructive" : "text-primary"}>Deadlines don't.</span>
          </h1>
          <p className="mt-5 max-w-md text-muted-foreground">
            When a cyberattack locks your document system, Vigil gets lawyers the files they need —
            routed by the Help Desk, claimed by Technical IT, tracked end to end.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-px border bg-border font-mono">
            {[
              [
                "Status",
                active ? "ACTIVE" : v.role && !v.loading && !v.error ? "CLEAR" : "--",
                active ? "text-destructive" : "text-safe",
              ],
              ["Open requests", String(open), "text-foreground"],
              ["Awaiting owner", String(unowned), unowned ? "text-accent" : "text-foreground"],
            ].map(([k, val, c]) => (
              <div key={k} className="bg-background p-4">
                <p className={`text-2xl ${c}`}>{val}</p>
                <p className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">{k}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative min-h-[420px] overflow-hidden border bg-card/40">
          <RadarShield underAttack={radarAlert} />
          <button
            type="button"
            aria-label="Start demo radar scan"
            aria-disabled={radarAlert || demoScan === "scanning"}
            onClick={() => {
              if (!radarAlert && demoScan === "ready") setDemoScan("scanning");
            }}
            className="absolute inset-0 w-full cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary aria-disabled:cursor-default"
          />
          <span
            role="status"
            className="pointer-events-none absolute bottom-4 left-4 font-mono text-[10px] uppercase tracking-widest"
          >
            {radarAlert ? "" : demoScan === "scanning" ? "Scanning…" : "Tap radar to scan"}
          </span>
        </div>
      </div>

      <div className="grid gap-px border bg-border md:grid-cols-3">
        {ROLES.map((r) => (
          <Link
            key={r.role}
            to={v.role === r.role ? r.to : "/sign-in/$role"}
            params={{ role: r.role }}
            className="group bg-background p-6 transition-colors hover:bg-card"
          >
            <p className="font-mono text-xs text-primary">{r.n}</p>
            <p className="mt-3 text-xl font-semibold">
              {r.t}{" "}
              <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{r.d}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Panel title="Incident status">
          <Sparkline attack={active} height={90} />
        </Panel>
        <Panel title="Response">
          <p className="text-sm text-muted-foreground">
            {v.detail?.incident.title ?? "Sign in to your workspace to see incident details."}
          </p>
        </Panel>
      </div>
    </div>
  );
}
