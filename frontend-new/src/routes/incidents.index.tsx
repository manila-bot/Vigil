import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/vigil/AppShell";
import { Button } from "@/components/ui/button";
import { setState, useCurrentUser } from "@/lib/vigil";
import { useIncident } from "@/lib/incident";
import { api, fmtTime, LABELS, USE_MOCKS } from "@/lib/api";

export const Route = createFileRoute("/incidents/")({ head: () => ({ meta: [
  { title: "Incidents — Vigil" }, { name: "description", content: "Active security incidents and manual incident reporting for your law firm." },
  { property: "og:title", content: "Incidents — Vigil" }, { property: "og:description", content: "Incident reporting and active incident response." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
] }), component: Incidents });

function Incidents() {
  return <AppShell><div className="mx-auto max-w-5xl space-y-6"><h1 className="text-3xl">Incidents</h1>
    {USE_MOCKS ? <SampleIncidents /> : <LiveIncidents />}
  </div></AppShell>;
}

function LiveIncidents() {
  const user = useCurrentUser(); const nav = useNavigate(); const client = useQueryClient();
  const list = useQuery({ queryKey: ["vigil", "incidents"], queryFn: api.incidents, enabled: !!user, refetchInterval: 3000, retry: false });
  const [title, setTitle] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function report(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim()) return;
    setBusy(true); setErr("");
    try {
      const d = await api.createIncident(title.trim());
      await client.invalidateQueries({ queryKey: ["vigil"] });
      await nav({ to: "/incidents/$id", params: { id: String(d.incident.id) } });
    } catch (error) { setErr(error instanceof Error ? error.message : "Unable to report incident."); } finally { setBusy(false); }
  }
  return <>
    {list.isPending ? <p role="status">Loading incidents…</p> : list.error ? <p role="alert" className="text-threat">Incidents could not load: {list.error.message}</p> :
      list.data.length === 0 ? <p className="text-muted-foreground">No incidents yet.</p> :
      <ul className="divide-y border-y">{list.data.map((i) => <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
        <span className="font-mono text-xs text-brass">{i.code}</span>
        <span className="min-w-0 flex-1"><span className="block truncate">{i.title}</span><span className="text-xs text-muted-foreground">{LABELS.status[i.status]} · {LABELS.severity[i.severity]} · {i.open_tasks ?? 0} open tasks · updated {fmtTime(i.updated_at)}</span></span>
        <Button asChild size="sm" variant={i.status === "closed" ? "outline" : "default"}><Link to="/incidents/$id" params={{ id: String(i.id) }}>Open</Link></Button>
      </li>)}</ul>}
    <section className="space-y-4 border-t pt-6"><h2 className="text-xl">Report incident</h2>
      <form className="max-w-xl space-y-3" onSubmit={report}>
        <label className="block space-y-2 text-sm"><span>What's happening?</span><textarea required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-24 w-full rounded-md border bg-input/30 p-3 outline-none focus:border-ring" /></label>
        {err && <p role="alert" className="text-sm text-threat">{err}</p>}
        <Button disabled={busy || !title.trim()}>{busy ? "Reporting…" : "Report incident"}</Button>
      </form>
    </section>
  </>;
}

function SampleIncidents() {
  const incident = useIncident(); const [title, setTitle] = useState(""); const [saved, setSaved] = useState(false);
  return <>
    {incident.activeIncident ?
      <article className="space-y-3 rounded-lg border border-threat/50 bg-card p-5"><div className="font-mono text-xs text-brass">{incident.activeIncident.id} · Active · sample</div><h2 className="text-xl">{incident.activeIncident.title}</h2><Button asChild><Link to="/incidents/$id" params={{ id: incident.activeIncident.id }}>Open active incident</Link></Button></article> : <p className="text-muted-foreground">No active incident.</p>}
    <section className="space-y-4 border-t pt-6"><h2 className="text-xl">Report incident</h2>
      <form className="max-w-xl space-y-3" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; setState((s) => ({ ...s, attack: true, attackAt: s.attackAt ?? Date.now(), timeline: [...s.timeline, { id: crypto.randomUUID(), at: Date.now(), text: `Manual report: ${title.trim()}`, kind: "info" }] })); setTitle(""); setSaved(true); }}>
        <label className="block space-y-2 text-sm"><span>What's happening?</span><textarea required value={title} onChange={(e) => setTitle(e.target.value)} className="min-h-24 w-full rounded-md border bg-input/30 p-3 outline-none focus:border-ring" /></label>
        <Button disabled={!title.trim()}>Report incident</Button>
        {saved && <p role="status" className="text-sm text-healthy">Sample report saved. The sample incident is active.</p>}
      </form>
    </section>
  </>;
}
