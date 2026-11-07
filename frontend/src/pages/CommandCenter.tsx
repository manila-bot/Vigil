import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, Clock, FilePlus2, ListChecks, Server, ShieldAlert, Zap } from "lucide-react";
import { get, post } from "../api/client";
import { Badge, ErrorBanner, fmtTime, LABELS, Spinner, StaleBanner, usePoll } from "../components/ui";

export default function CommandCenter() {
  const nav = useNavigate();
  const { data, error, stale } = usePoll(() => get("/dashboard"));
  const [simMsg, setSimMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function simulate(fixture: string) {
    setBusy(true);
    setSimMsg(null);
    setActionError(null);
    try {
      const r = await post("/demo/simulate", { fixture });
      if (r.detected) nav(`/incidents/${r.incident_id}`);
      else setSimMsg(r.message);
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const urgent = data.urgent_deadlines?.[0];

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Command Center</h1>
          <p className="text-sm text-slate-500">Updated {fmtTime(data.server_time)} · refreshes every 2 seconds</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => simulate("ransomware_burst")} disabled={busy}>
            <Zap className="h-4 w-4 text-purple-600" /> Simulate attack <span className="text-xs text-purple-700">(demo)</span>
          </button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <FilePlus2 className="h-4 w-4" /> Create incident
          </button>
        </div>
      </header>
      <StaleBanner stale={stale} error={error} />
      <ErrorBanner message={actionError} />
      {simMsg && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{simMsg}</div>
      )}
      {showCreate && <CreateIncident onClose={() => setShowCreate(false)} onCreated={(id) => nav(`/incidents/${id}`)} />}

      {/* The urgent filing card leads */}
      {urgent ? (
        <Link to={`/incidents/${urgent.incident_id}`}
          className="mb-6 block rounded-2xl border-2 border-red-300 bg-red-50 p-6 transition hover:border-red-400">
          <div className="flex items-start gap-4">
            <Clock className="mt-1 h-8 w-8 shrink-0 text-red-600" />
            <div className="flex-1">
              <div className="text-xs font-bold uppercase tracking-wider text-red-700">Most urgent deadline at risk</div>
              <div className="mt-1 text-3xl font-bold text-red-900">
                {urgent.deadline_local} {urgent.deadline_label}
              </div>
              <div className="mt-1 text-sm text-red-900">
                {urgent.matter_code} · {urgent.title}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {urgent.availability.map((a: string) => <Badge key={a} kind="availability" value={a} />)}
                {urgent.copying.map((c: string) => <Badge key={c} kind="copying" value={c} />)}
                <span className="text-xs text-red-800">Lead: {urgent.lead_name} ({urgent.lead_role}) · {urgent.incident_code}</span>
              </div>
            </div>
            <span className="btn-danger self-center">Open incident →</span>
          </div>
        </Link>
      ) : (
        <div className="card mb-6 flex items-center gap-3 p-6 text-slate-600">
          <ShieldAlert className="h-6 w-6 text-emerald-600" /> No deadlines at risk right now.
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat icon={<Server className="h-5 w-5" />} label="Affected systems" value={new Set(data.affected_systems.map((s: any) => s.system)).size} />
        <Stat icon={<ListChecks className="h-5 w-5" />} label="Open tasks" value={data.open_tasks.length} />
        <Stat icon={<ShieldAlert className="h-5 w-5" />} label="Unverified data exposure" value={data.unverified_exposure_count}
          hint="Scope items where copying is unknown or suspected" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className="card lg:col-span-3">
          <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Active incidents</h2>
          {data.incidents.length === 0 && <p className="p-5 text-sm text-slate-500">No open incidents.</p>}
          <ul className="divide-y divide-slate-100">
            {data.incidents.map((i: any) => (
              <li key={i.id}>
                <Link to={`/incidents/${i.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="font-mono text-xs text-slate-500">{i.code}</span>
                  <span className="flex-1 truncate text-sm font-medium">{i.title}</span>
                  <Badge kind="severity" value={i.severity} />
                  <Badge kind="status" value={i.status} />
                </Link>
              </li>
            ))}
          </ul>
          <h2 className="border-y border-slate-100 px-5 py-3 font-semibold">Open tasks</h2>
          <ul className="divide-y divide-slate-100">
            {data.open_tasks.length === 0 && <li className="p-5 text-sm text-slate-500">No open tasks.</li>}
            {data.open_tasks.map((t: any) => (
              <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <Badge kind="severity" value={t.priority} />
                <Link to={`/incidents/${t.incident_id}`} className="flex-1 truncate hover:underline">{t.title}</Link>
                <span className="text-xs text-slate-500">{t.owner_name ?? t.owner_label ?? "Unassigned"} · due {fmtTime(t.due_at)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card lg:col-span-2">
          <h2 className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 font-semibold">
            <Activity className="h-4 w-4" /> Recent activity
          </h2>
          <ul className="max-h-[480px] divide-y divide-slate-100 overflow-auto">
            {data.recent_activity.map((e: any) => (
              <li key={e.id} className="px-5 py-2.5 text-sm">
                <div className="text-xs text-slate-500">
                  {fmtTime(e.at)} · {e.incident_code} · {e.actor_name ?? "System"}
                </div>
                <div>{e.summary}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <button className="mt-6 text-xs text-slate-500 underline" onClick={() => simulate("normal_activity")} disabled={busy}>
        Demo: scan normal activity logs (should raise no alert)
      </button>
    </div>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint?: string }) {
  return (
    <div className="card flex items-center gap-4 p-5" title={hint}>
      <div className="rounded-lg bg-navy-700/10 p-2.5 text-navy-700">{icon}</div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
      </div>
    </div>
  );
}

function CreateIncident({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("high");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await post("/incidents", { title, severity, summary: summary || undefined });
      onCreated(r.incident.id);
    } catch (err: any) {
      setError(err.message);
    }
  }
  return (
    <form onSubmit={submit} className="card mb-6 space-y-3 p-5">
      <h2 className="font-semibold">Create incident</h2>
      <ErrorBanner message={error} />
      <div>
        <label className="label">What happened? (short title)</label>
        <input className="input" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Staff can't open files in the document system" />
      </div>
      <div>
        <label className="label">Severity</label>
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {Object.entries(LABELS.severity).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Details (optional)</label>
        <textarea className="input" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button className="btn-primary">Create incident</button>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
