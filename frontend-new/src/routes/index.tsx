import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CalendarClock, ListChecks, ShieldCheck, ShieldQuestion, Zap } from "lucide-react";
import { AppShell } from "@/components/vigil/AppShell";
import { ThreatOrb } from "@/components/vigil/ThreatOrb";
import { Button } from "@/components/ui/button";
import { useIncident } from "@/lib/incident";
import { actions, useCurrentUser } from "@/lib/vigil";
import { api, fmtTime, LABELS, USE_MOCKS } from "@/lib/api";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Command Center — Vigil" }, { name: "description", content: "Active security incidents and filing recovery for your law firm." },
    { property: "og:title", content: "Command Center — Vigil" }, { property: "og:description", content: "Active incidents for counsel and IT." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }), component: Command,
});

function Command() {
  return <AppShell><div className="mx-auto max-w-5xl space-y-6">
    <div><div className="font-mono text-xs uppercase text-brass">Harlow & Reed LLP</div><h1 className="mt-2 text-3xl">Command Center</h1></div>
    {USE_MOCKS ? <SampleCommand /> : <LiveCommand />}
  </div></AppShell>;
}

function SampleCommand() {
  const incident = useIncident();
  return incident.activeIncident ?
    <article className="flex flex-col items-start gap-6 rounded-lg border border-threat/50 bg-card p-6 sm:flex-row sm:items-center">
      <ThreatOrb attack size={160} />
      <div className="min-w-0 flex-1 space-y-3"><div className="font-mono text-xs text-threat">{incident.activeIncident.id} · Active incident · sample</div>
        <h2 className="text-2xl">{incident.activeIncident.title}</h2>
        <Button asChild><Link to="/incidents/$id" params={{ id: incident.activeIncident.id }}>Open active incident <ArrowRight /></Link></Button>
      </div>
    </article> :
    <section className="space-y-4 border-y py-10"><ShieldCheck className="h-10 w-10 text-healthy" /><h2 className="text-2xl">No active incident</h2>
      <Button variant="outline" onClick={() => actions.simulateAttack()}><Zap />Simulate attack (sample)</Button></section>;
}

function LiveCommand() {
  const user = useCurrentUser();
  const nav = useNavigate();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const dash = useQuery({ queryKey: ["vigil", "dashboard"], queryFn: api.dashboard, enabled: !!user, refetchInterval: 2000, retry: false });

  async function simulate(fixture: "ransomware_burst" | "normal_activity") {
    setBusy(true);
    try {
      const r = await api.simulate(fixture);
      await client.invalidateQueries({ queryKey: ["vigil"] });
      if (r.incident_id) {
        if (r.message) toast.info(r.message);
        await nav({ to: "/incidents/$id", params: { id: String(r.incident_id) } });
      } else toast.success(r.message ?? "No suspicious activity found.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Simulation failed.");
    } finally { setBusy(false); }
  }

  if (dash.isPending) return <p role="status">Loading Command Center…</p>;
  if (dash.error) return <p role="alert" className="rounded-lg border border-threat/50 p-4 text-threat">Unable to load the Command Center: {dash.error.message}</p>;
  const d = dash.data;
  const active = d.incidents[0];
  const urgent = d.urgent_deadlines[0];

  return <div className="space-y-6">
    {active ?
      <article className="flex flex-col items-start gap-6 rounded-lg border border-threat/50 bg-card p-6 sm:flex-row sm:items-center">
        <ThreatOrb attack size={160} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="font-mono text-xs text-threat">{active.code} · {LABELS.status[active.status]} · {LABELS.severity[active.severity]}{active.source === "simulated" ? " · simulated" : ""}</div>
          <h2 className="text-2xl">{active.title.replace("[SIMULATED] ", "")}</h2>
          {urgent && <p className="flex items-center gap-2 text-risk"><CalendarClock className="h-4 w-4" />{urgent.deadline_local} {urgent.deadline_label ?? "deadline"} — {urgent.matter_code} at risk</p>}
          <div className="flex flex-wrap gap-2">
            <Button asChild><Link to="/incidents/$id" params={{ id: String(active.id) }}>Open active incident <ArrowRight /></Link></Button>
            <Button variant="outline" disabled={busy} onClick={() => void simulate("ransomware_burst")}><Zap />{busy ? "Simulating…" : "Simulate attack"}</Button>
          </div>
        </div>
      </article> :
      <section className="space-y-4 border-y py-10"><ShieldCheck className="h-10 w-10 text-healthy" /><h2 className="text-2xl">No active incident</h2>
        <p className="text-sm text-muted-foreground">Replay the synthetic ransomware log to see how Vigil opens an incident. All demo data is fictional.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void simulate("ransomware_burst")}><Zap />{busy ? "Simulating…" : "Simulate attack"}</Button>
          <Button variant="outline" disabled={busy} onClick={() => void simulate("normal_activity")}>Check normal activity</Button>
          <Button variant="ghost" asChild><Link to="/incidents">Report incident</Link></Button>
        </div>
      </section>}

    <dl className="grid gap-4 sm:grid-cols-3">
      <Stat icon={CalendarClock} label="Deadlines at risk" value={d.urgent_deadlines.length} tone={d.urgent_deadlines.length ? "text-threat" : "text-healthy"} />
      <Stat icon={ShieldQuestion} label="Copying unverified" value={d.unverified_exposure_count} tone={d.unverified_exposure_count ? "text-risk" : "text-healthy"} />
      <Stat icon={ListChecks} label="Open tasks" value={d.open_tasks.length} tone="text-foreground" />
    </dl>

    {d.incidents.length > 1 && <section className="space-y-2"><h2 className="text-xl">Other open incidents</h2>
      <ul className="divide-y border-y text-sm">{d.incidents.slice(1).map((i) => <li key={i.id} className="flex items-center gap-3 py-2">
        <span className="font-mono text-xs text-brass">{i.code}</span><span className="min-w-0 flex-1 truncate">{i.title}</span>
        <Link className="text-primary hover:underline" to="/incidents/$id" params={{ id: String(i.id) }}>Open</Link></li>)}</ul></section>}

    {d.open_tasks.length > 0 && <section className="space-y-2"><h2 className="text-xl">Open tasks</h2>
      <ul className="divide-y border-y text-sm">{d.open_tasks.map((t) => <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
        <span className="min-w-0 flex-1">{t.title}</span><span className="text-muted-foreground">{t.owner_name ?? t.owner_label ?? "Unassigned"} · {LABELS.task[t.status]}</span>
        <Link className="text-primary hover:underline" to="/incidents/$id" params={{ id: String(t.incident_id) }}>Open</Link></li>)}</ul></section>}

    <section className="space-y-2"><h2 className="text-xl">Recent activity</h2>
      {d.recent_activity.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> :
        <ol className="space-y-2 text-sm">{d.recent_activity.map((a) => <li key={a.id}><span className="font-mono text-xs text-muted-foreground">{fmtTime(a.at)} · {a.incident_code}</span><p>{a.summary}</p></li>)}</ol>}
    </section>
  </div>;
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof CalendarClock; label: string; value: number; tone: string }) {
  return <div className="flex gap-3 rounded-lg border bg-card p-4"><Icon className={`mt-1 h-5 w-5 ${tone}`} /><div><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`text-2xl font-semibold ${tone}`}>{value}</dd></div></div>;
}
