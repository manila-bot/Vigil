import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Clock, Database, FilePlus2, ListChecks, Server, ShieldQuestion, UserRound } from "lucide-react";
import { get, post } from "../api/client";
import { Badge, ErrorBanner, fmtTime, LABELS, Spinner, StaleBanner, StatTile, usePoll } from "../components/ui";

export function timeLeft(iso?: string | null) {
  if (!iso) return null;
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) return "Deadline passed";
  const h = Math.floor(mins / 60), m = mins % 60;
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : `${h}h ${m}m left`;
}

const FILTERS: Record<string, (k: string) => boolean> = {
  All: () => true,
  Detection: (k) => ["detection", "evidence_added", "scope_added", "scope_updated", "incident_created"].includes(k),
  "AI & tasks": (k) => k.startsWith("triage") || k.startsWith("task"),
  Alerts: (k) => k.startsWith("alert"),
  Chat: (k) => k === "message",
};

export default function CommandCenter() {
  const nav = useNavigate();
  const { data, error, stale } = usePoll(() => get("/dashboard"));
  const active = data?.incidents?.[0];
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState("All");

  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const urgent = data.urgent_deadlines?.[0];
  const systems = Array.from(new Set(data.affected_systems.map((s: any) => s.system))) as string[];
  const activity = data.recent_activity.filter((e: any) => FILTERS[filter](e.kind));
  const today = new Date().toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

  return (
    <div>
      {/* Title + KPI tiles */}
      <section className="mb-6 grid grid-cols-1 items-end gap-5 xl:grid-cols-[1fr_auto]">
        <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight">
          Incident<br />Command Center
        </h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile icon={<Server className="h-6 w-6" />} label="Systems affected" value={systems.length}
            note={systems.length ? systems.join(", ") : "All systems normal"} tone={systems.length ? "critical" : "ok"} />
          <StatTile icon={<ListChecks className="h-6 w-6" />} label="Open tasks" value={data.open_tasks.length}
            note={data.open_tasks.length ? "Assigned to team members" : "Nothing waiting"} />
          <StatTile icon={<ShieldQuestion className="h-6 w-6" />} label="Data copying unverified" value={data.unverified_exposure_count}
            note={data.unverified_exposure_count ? "Still need to confirm" : "None outstanding"} tone={data.unverified_exposure_count ? "warning" : "ok"} />
        </div>
      </section>

      {/* Action bar */}
      <section className="card mb-6 flex flex-wrap items-center gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="icon-btn"><Database className="h-4 w-4" /></span>
          <div className="leading-tight">
            <div className="text-sm font-medium">Incident records</div>
            <div className="text-xs text-faint">Today · {today} · live, updates every 2 s</div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {data.urgent_deadlines.length > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-red-300">
              <AlertTriangle className="h-4 w-4" /> {data.urgent_deadlines.length} legal deadline{data.urgent_deadlines.length > 1 ? "s" : ""} at risk
            </span>
          )}
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <FilePlus2 className="h-4 w-4" /> Create incident
          </button>
        </div>
      </section>

      <StaleBanner stale={stale} error={error} />
      {showCreate && <CreateIncident onClose={() => setShowCreate(false)} onCreated={(id) => nav(`/incidents/${id}`)} />}

      {!active ? (
        <AllClear />
      ) : (
        <section className="mb-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* 1. What's at risk */}
          <div className="card flex flex-col p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="card-title">What's at risk</h2>
              <Link to={`/incidents/${active.id}`} className="icon-btn h-8 w-8" aria-label="Open incident"><ArrowUpRight className="h-4 w-4" /></Link>
            </div>
            {urgent ? (
              <>
                <div className="text-xs uppercase tracking-wider text-faint">Next legal deadline</div>
                <div className="mt-1 text-4xl font-semibold tracking-tight text-accent">{urgent.deadline_local}</div>
                <div className="text-lg">{urgent.deadline_label}</div>
                <div className="mt-1 flex items-center gap-1.5 text-sm text-red-300">
                  <Clock className="h-4 w-4" /> {timeLeft(urgent.deadline_at)}
                </div>
                <div className="mt-4 text-sm text-muted">{urgent.matter_code} · {urgent.title}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {urgent.availability.map((a: string) => <Badge key={a} kind="availability" value={a} />)}
                  {urgent.copying.map((c: string) => <Badge key={c} kind="copying" value={c} />)}
                </div>
                <div className="mt-auto flex items-center gap-3 rounded-2xl bg-panel2 p-3 pt-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent"><UserRound className="h-5 w-5" /></span>
                  <div className="leading-tight">
                    <div className="text-[11px] text-faint">Matter lead</div>
                    <div className="text-sm font-medium">{urgent.lead_name}</div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">No legal deadlines are affected by open incidents.</p>
            )}
          </div>

          {/* 2. Where the response stands */}
          <div className="card p-6">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="card-title">Response progress</h2>
              <span className="rounded-full bg-lime-soft px-2.5 py-0.5 text-xs font-medium text-lime">{LABELS.status[active.status]}</span>
            </div>
            <div className="mb-4 text-xs text-faint">{active.code}</div>
            <p className="text-sm text-muted">
              Open the incident to review filing risk, request help, or see who owns recovery.
            </p>
            <Link to={`/incidents/${active.id}`} className="btn-primary mt-5 w-full">
              Open active incident
            </Link>
          </div>

          {/* 3. Systems + tasks */}
          <div className="card p-6">
            <h2 className="card-title mb-4">Affected systems</h2>
            <ul className="mb-6 space-y-2">
              {data.affected_systems.map((s: any, i: number) => (
                <li key={i} className="flex items-center justify-between rounded-2xl bg-panel2 px-4 py-3 text-sm">
                  {s.system} <Badge kind="availability" value={s.availability} />
                </li>
              ))}
            </ul>
            <h2 className="card-title mb-3">Open tasks</h2>
            <ul className="space-y-2">
              {data.open_tasks.length === 0 && <li className="text-sm text-faint">No tasks yet. Approve an AI plan or add one.</li>}
              {data.open_tasks.slice(0, 4).map((t: any) => (
                <li key={t.id} className="text-sm">
                  <div className="truncate">{t.title}</div>
                  <div className="text-xs text-faint">{t.owner_name ?? t.owner_label ?? "Unassigned"} · due {fmtTime(t.due_at)}</div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Recent activity table */}
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">Recent activity</h2>
          <div className="flex gap-1">
            {Object.keys(FILTERS).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={filter === f ? "pill-active py-1 text-xs" : "pill py-1 text-xs"}>{f}</button>
            ))}
          </div>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-left text-xs text-faint">
              <tr><th className="px-5 py-3 font-medium">Time</th><th className="px-5 py-3 font-medium">Incident</th>
                <th className="px-5 py-3 font-medium">What happened</th><th className="px-5 py-3 font-medium">By</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {activity.length === 0 && <tr><td colSpan={4} className="px-5 py-6 text-center text-faint">Nothing here yet.</td></tr>}
              {activity.map((e: any) => (
                <tr key={e.id} className="hover:bg-panel2/60">
                  <td className="whitespace-nowrap px-5 py-3 text-muted">{fmtTime(e.at)}</td>
                  <td className="px-5 py-3"><Link to={`/incidents/${e.incident_id}`} className="font-mono text-xs text-accent hover:underline">{e.incident_code}</Link></td>
                  <td className="px-5 py-3">{e.summary}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-muted">{e.actor_name ?? "System"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function AllClear() {
  return (
    <section className="card mb-6 grid grid-cols-1 gap-6 p-8 md:grid-cols-[1.2fr_1fr]">
      <div>
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-lime-soft px-3 py-1 text-xs font-medium text-lime">● All clear</div>
        <h2 className="text-2xl font-semibold">No open incidents</h2>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
          Vigil is the firm's backup command center for cyber attacks. It runs on its own server with its own logins,
          so it keeps working when email and file systems don't. When something happens, it shows what work is at risk,
          what happened to the data, and who's doing what.
        </p>
      </div>
      <ol className="space-y-3 text-sm">
        {["Detect: logs show files being locked", "Assess: see which matters and deadlines are hit",
          "Plan: AI drafts tasks from the evidence", "Approve: a person signs off; nothing runs before that",
          "Alert & coordinate: phone alert, chat, timeline"].map((t, i) => (
          <li key={t} className="flex gap-3 rounded-2xl bg-panel2 px-4 py-3">
            <span className="font-semibold text-accent">{i + 1}</span><span className="text-muted">{t}</span>
          </li>
        ))}
      </ol>
    </section>
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
    <form onSubmit={submit} className="card mb-6 grid grid-cols-1 gap-4 p-6 md:grid-cols-[2fr_1fr]">
      <h2 className="card-title col-span-full">Create incident</h2>
      <div className="col-span-full"><ErrorBanner message={error} /></div>
      <div>
        <label className="label">What happened? (short title)</label>
        <input className="input" required autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Staff can't open files in the document system" />
      </div>
      <div>
        <label className="label">How serious?</label>
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {Object.entries(LABELS.severity).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="col-span-full">
        <label className="label">Details (optional)</label>
        <textarea className="input" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="col-span-full flex gap-2">
        <button className="btn-primary">Create incident</button>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
