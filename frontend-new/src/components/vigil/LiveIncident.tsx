// Live incident workspace. Every control calls the FastAPI route listed in backend/API_CONTRACT.md;
// mutations return the full incident payload, which replaces the polled cache.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, CalendarClock, Check, CircleDashed, FileWarning, Hand, LifeBuoy, Loader2, Phone, RotateCw, Send, UserRound, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ThreatOrb } from "@/components/vigil/ThreatOrb";
import {
  api, fmtTime, isITResponder, isLitigation, LABELS, useSessionUser,
  type Availability, type Certainty, type Copying, type FilingRequest, type IncidentDetail, type IncidentStatus, type ITRequest, type Task, type TaskStatus,
} from "@/lib/api";
import { urgentMatter, useLiveIncident } from "@/lib/incident";
import { cn } from "@/lib/utils";

type Run = (label: string, fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;
const field = "rounded-md border bg-input/30 px-3 py-2 text-sm outline-none focus:border-ring";
const tone = { critical: "border-threat/60 text-threat", warning: "border-risk/60 text-risk", ok: "border-healthy/60 text-healthy" } as const;

export function LiveIncident({ id }: { id: string }) {
  const { query, data, apply } = useLiveIncident(id);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const run: Run = async (label, fn, ok) => {
    setBusy(label); setActionError(null);
    try {
      const r = await fn();
      if (r && typeof r === "object" && "incident" in r) apply(r as IncidentDetail);
      if (ok) toast.success(ok);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to complete this action.";
      setActionError(msg); toast.error(msg);
      return false;
    } finally { setBusy(null); }
  };

  if (query.isPending) return <p role="status">Loading incident…</p>;
  if (query.error && !data) return <p role="alert" className="rounded-lg border border-threat/50 p-4 text-threat">Unable to load incident: {query.error.message}</p>;
  if (!data) return null;
  const d = data;
  const inc = d.incident;
  const urgent = urgentMatter(d);
  const locked = d.scope.filter((s) => s.availability === "locked" || s.availability === "destroyed").length;
  const filingRequest = d.requests[0];
  const filingTasks = d.tasks.filter((t) => d.requests.some((r) => r.task_id === t.id));
  const owner = filingTasks[0]?.owner_name ?? (filingTasks[0] ? (filingRequest?.status === "acknowledged" ? "Acknowledged — waiting for an owner" : "Unclaimed — waiting for IT") : "No filing task yet");

  return <div className="space-y-6">
    <section className="space-y-5 border-b border-threat/50 pb-6">
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        <Link to="/" className="text-muted-foreground hover:text-foreground">← Command Center</Link>
        <span className="text-brass">{inc.code}</span>
        <span className={inc.status === "closed" ? "text-healthy" : "text-threat"}>{LABELS.status[inc.status]} · {LABELS.severity[inc.severity]}</span>
        {inc.source === "simulated" && <span className="rounded border border-risk/50 px-1.5 text-risk">Simulated</span>}
        <label className="ml-auto flex items-center gap-2 font-sans text-sm"><span className="text-muted-foreground">Status</span>
          <select aria-label="Incident status" className={field} value={inc.status} disabled={!!busy}
            onChange={(e) => void run("status", () => api.updateIncident(id, { status: e.target.value as IncidentStatus }), "Status updated")}>
            {Object.entries(LABELS.status).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></label>
      </div>
      <div className="flex items-center gap-5">
        {inc.status !== "closed" && <ThreatOrb attack size={84} />}
        <div className="min-w-0"><h1 className="text-3xl">{inc.title.replace("[SIMULATED] ", "")}</h1>
          {inc.summary && <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{inc.summary}</p>}</div>
      </div>
      {d.headline.length > 0 && <div className="flex flex-wrap gap-2">{d.headline.map((h) => <span key={h.label} className={cn("rounded-full border px-3 py-1 text-xs", tone[h.tone])}>{h.label}</span>)}</div>}
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact icon={CalendarClock} label="Filing deadline" value={urgent ? `${urgent.deadline_local} ${urgent.deadline_label ?? ""} · ${urgent.matter_code}` : "No deadline at risk"} />
        <Fact icon={FileWarning} label="File availability" value={locked ? `${locked} data set${locked > 1 ? "s" : ""} inaccessible` : "No inaccessible data recorded"} />
        <Fact icon={CircleDashed} label="Data copying" value={d.counts.unverified_exposure ? `Unverified for ${d.counts.unverified_exposure} data set${d.counts.unverified_exposure > 1 ? "s" : ""}` : d.scope.length ? "No unverified copying" : "Not assessed yet"} />
        <Fact icon={UserRound} label="Filing task owner" value={owner} />
      </dl>
      {actionError && <p role="alert" className="text-sm text-threat">{actionError}</p>}
      {query.error && <p role="alert" className="text-sm text-risk">Live refresh failed ({query.error.message}). Showing the last loaded data.</p>}
      <FilingHelp d={d} id={id} run={run} busy={busy} />
    </section>

    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <ResponseRoom d={d} id={id} run={run} busy={busy} />
        <Tasks d={d} id={id} run={run} busy={busy} />
      </div>
      <div className="space-y-6">
        <ITHelp id={id} d={d} />
        <Triage d={d} id={id} run={run} busy={busy} />
      </div>
    </div>

    <div className="divide-y border-y">
      <Section title={`Scope (${d.scope.length})`} open><Scope d={d} id={id} run={run} busy={busy} /></Section>
      <Section title={`Evidence (${d.evidence.length})`}>
        {d.evidence.length === 0 ? <p className="text-sm text-muted-foreground">No evidence recorded.</p> :
          <ul className="space-y-3 text-sm">{d.evidence.map((e) => <li key={e.id} id={e.ref}>
            <div className="font-mono text-xs text-brass">{e.ref} · {e.kind.replace(/_/g, " ")} · {fmtTime(e.observed_at)} · {LABELS.certainty[e.certainty]}{e.is_simulated ? " · simulated" : ""}</div>
            <p>{e.description}</p></li>)}</ul>}
      </Section>
      <Section title="Timeline">
        <ol className="space-y-2 text-sm">{[...d.timeline].reverse().map((t) => <li key={t.id}>
          <div className="font-mono text-xs text-muted-foreground">{fmtTime(t.at)} · {t.actor_name ?? "System"} · {t.kind}</div><p>{t.summary}</p></li>)}</ol>
      </Section>
    </div>
  </div>;
}

// ---------- filing help: litigation responder -> linked IT task (POST /incidents/{id}/requests) ----------
function FilingHelp({ d, id, run, busy }: { d: IncidentDetail; id: string; run: Run; busy: string | null }) {
  const me = useSessionUser();
  const matters = d.matters_at_risk.filter((m) => m.deadline_at);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<typeof matters>([]); // frozen while the dialog is open so polling can't change the selection
  const [matter, setMatter] = useState(matters[0]?.matter_code ?? "");
  const [body, setBody] = useState(`Please find and verify a clean copy of the ${matters[0]?.matter_code ?? ""} filing exhibits.`);
  if (!isLitigation(me) || !matters.length) return null;
  const mine = d.requests.filter((r) => r.requester_id === me?.id);
  const pending = matters.filter((m) => !mine.some((r) => r.matter_code === m.matter_code));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run("filing", () => api.requestFilingHelp(id, matter, body.trim()), "IT request saved")) setOpen(false);
  }
  return <div className="flex flex-wrap items-start gap-5 border-t pt-4">
    {mine.map((r) => <div key={r.id} role="status" className="space-y-1">
      <div className={cn("font-medium", r.status === "done" ? "text-healthy" : "text-primary")}>IT request #{r.id} · {r.matter_code}: {requestLabel(r)}</div>
      <p className="max-w-xl text-sm text-muted-foreground">“{r.body}”{r.provider && ` · drafted by ${r.provider === "nemotron" ? "live Nemotron" : "fixture (not live AI)"}`}</p>
      {r.triage_error && <p className="text-sm text-risk">{r.triage_error}</p>}
    </div>)}
    {pending.length > 0 && d.incident.status !== "closed" &&
      <Button disabled={!!busy} onClick={() => { setChoices(pending); setMatter(pending[0]!.matter_code); setBody(`Please find and verify a clean copy of the ${pending[0]!.matter_code} filing exhibits.`); setOpen(true); }}><Hand />Request IT help</Button>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
      <DialogTitle>Request IT help</DialogTitle><DialogDescription>Saved first, then Nemotron drafts an IT task linked to this filing.</DialogDescription>
      <form className="space-y-4" onSubmit={submit}>
        <label className="block space-y-2 text-sm"><span>Filing</span>
          <select className={cn(field, "w-full")} value={matter} onChange={(e) => { const m = e.target.value; setMatter(m); setBody(`Please find and verify a clean copy of the ${m} filing exhibits.`); }}>
            {choices.map((m) => <option key={m.matter_code} value={m.matter_code}>{m.matter_code} · {m.deadline_local} {m.deadline_label ?? ""}</option>)}
          </select></label>
        <label className="block space-y-2 text-sm"><span>Files needed for filing</span>
          <textarea aria-label="Files needed for filing" required maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} className="min-h-24 w-full rounded-md border bg-input/30 p-3 outline-none focus:border-ring" /></label>
        <Button disabled={!!busy || !body.trim()}>{busy === "filing" ? <><Loader2 className="animate-spin" />Saving and drafting…</> : "Submit request"}</Button>
      </form>
    </DialogContent></Dialog>
  </div>;
}

// ---------- response room ----------
function ResponseRoom({ d, id, run, busy }: { d: IncidentDetail; id: string; run: Run; busy: string | null }) {
  const me = useSessionUser();
  const [draft, setDraft] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [d.messages.length]);
  return <section className="space-y-3"><h2 className="text-xl">Response room <span className="text-sm text-muted-foreground">· inside Vigil, not firm email</span></h2>
    <div className="flex h-80 flex-col border-y">
      <div className="flex-1 space-y-3 overflow-auto py-4 text-sm" aria-live="polite">
        {!d.messages.length && <p className="text-muted-foreground">No updates yet. Say what you're working on.</p>}
        {d.messages.map((m) => <div key={m.id} className={cn(m.user_id === me?.id && "text-right")}>
          <div className="text-xs"><strong>{m.user_name}</strong>{m.team_role && <span className="text-muted-foreground"> · {m.team_role}</span>}<span className="ml-2 text-muted-foreground">{fmtTime(m.created_at)}</span></div>
          <p className="whitespace-pre-wrap break-words">{m.body}</p></div>)}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t py-3" onSubmit={(e) => { e.preventDefault(); const sent = draft.trim(); if (!sent) return;
        void run("post", () => api.postMessage(id, sent)).then((ok) => ok && setDraft((cur) => (cur.trim() === sent ? "" : cur))); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Post an update…" aria-label="Post an update" maxLength={4000} className={cn(field, "min-w-0 flex-1")} />
        <Button size="icon" aria-label="Send" title="Send update" disabled={!!busy || !draft.trim()}><Send /></Button>
      </form>
    </div>
  </section>;
}

// ---------- tasks: claim, status, add, Photon alert for filing tasks ----------
function Tasks({ d, id, run, busy }: { d: IncidentDetail; id: string; run: Run; busy: string | null }) {
  const me = useSessionUser();
  const [title, setTitle] = useState("");
  const users = useQuery({ queryKey: ["vigil", "users"], queryFn: api.users, staleTime: 30_000, retry: false });
  const itRecipients = (users.data ?? []).filter((u) => u.active && u.alert_opt_in && isITResponder(u));
  return <section className="space-y-3"><h2 className="text-xl">Tasks <span className="text-sm text-muted-foreground">· {d.counts.open_tasks} open</span></h2>
    <ul className="divide-y border-y text-sm">
      {d.tasks.length === 0 && <li className="py-3 text-muted-foreground">No tasks yet. Request IT help, approve an AI plan, or add one.</li>}
      {d.tasks.map((t) => {
        const filing = d.requests.some((r) => r.task_id === t.id);
        const lockedToOwner = filing && t.owner_user_id !== me?.id;
        return <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className={cn("font-medium", t.status === "done" && "text-muted-foreground line-through")}>#{t.id} · {t.title}</div>
            <div className="text-xs text-muted-foreground">{t.owner_name ?? t.owner_label ?? "Unassigned"} · due {fmtTime(t.due_at)} · {LABELS.severity[t.priority]}
              {t.evidence_refs.length > 0 && <> · {t.evidence_refs.map((r) => <a key={r} href={`#${r}`} className="ml-1 font-mono text-primary underline">{r}</a>)}</>}
              {t.source === "ai" && <> · AI-drafted{t.approved_by_name ? `, approved by ${t.approved_by_name}` : ""}</>}
              {filing && <> · filing request · {t.status === "done" ? "completed" : t.owner_user_id ? "claimed by IT" : d.requests.some((r) => r.task_id === t.id && r.status === "acknowledged") ? "acknowledged · waiting for an owner" : "waiting for IT"}</>}</div>
          </div>
          <select aria-label={`Status for task ${t.id}`} className={field} value={t.status} disabled={!!busy || lockedToOwner}
            title={lockedToOwner ? "Only the IT owner who claimed this task can change its status" : undefined}
            onChange={(e) => void run("task", () => api.updateTask(id, t.id, { status: e.target.value as TaskStatus }))}>
            {Object.entries(LABELS.task).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {filing && !t.owner_user_id && t.status === "open" && isITResponder(me) &&
            <Button size="sm" disabled={!!busy} onClick={() => void run("claim", () => api.claimTask(id, t.id), "Task claimed")}><Hand />{busy === "claim" ? "Claiming…" : "Claim task"}</Button>}
          {filing && !t.owner_user_id && t.status === "open" && <AlertIT task={t} recipients={itRecipients} id={id} run={run} busy={busy} />}
        </li>;
      })}
    </ul>
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = title.trim(); if (!v) return;
      void run("add-task", () => api.addTask(id, { title: v })).then((ok) => ok && setTitle("")); }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" aria-label="New task title" maxLength={300} className={cn(field, "min-w-0 flex-1")} />
      <Button variant="outline" disabled={!!busy || !title.trim()}>Add task</Button>
    </form>
  </section>;
}

function AlertIT({ task, recipients, id, run, busy }: { task: Task; recipients: { id: number; name: string; phone_masked: string | null }[]; id: string; run: Run; busy: string | null }) {
  const [to, setTo] = useState<number | "">("");
  if (!recipients.length) return <span className="text-xs text-muted-foreground">No consenting on-call IT for alerts</span>;
  return <span className="flex items-center gap-2">
    <select aria-label="Alert recipient" className={field} value={to} onChange={(e) => setTo(Number(e.target.value) || "")}>
      <option value="">Alert on-call IT…</option>{recipients.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.phone_masked})</option>)}
    </select>
    <Button size="sm" variant="outline" disabled={!!busy || !to} onClick={() => to && void run("alert", () => api.notify(id, to, task.id), "Alert requested")}><Phone />iMessage</Button>
  </span>;
}

// ---------- scope ----------
function Scope({ d, id, run, busy }: { d: IncidentDetail; id: string; run: Run; busy: string | null }) {
  const blank = { system: "", data_category: "", availability: "unknown" as Availability, copying: "unknown" as Copying, certainty: "unknown" as Certainty };
  const [f, setF] = useState(blank);
  const [adding, setAdding] = useState(false);
  return <div className="space-y-4">
    {d.matters_at_risk.length > 0 && <div className="grid gap-3 md:grid-cols-2">{d.matters_at_risk.map((m) => <div key={m.matter_code} className={cn("rounded-lg border bg-card p-4 text-sm", m.at_risk && "border-threat/50")}>
      <div className="font-mono text-xs text-brass">{m.matter_code}{m.is_simulated ? " · simulated" : ""}</div><div className="font-medium">{m.title}</div>
      {m.deadline_local && <div className={cn("mt-1", m.at_risk ? "text-threat" : "")}>{m.deadline_local} {m.deadline_label}</div>}
      <div className="text-xs text-muted-foreground">Lead: {m.lead_name ?? "not set"}{m.lead_role ? ` (${m.lead_role})` : ""}</div></div>)}</div>}
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground"><tr className="border-b"><th className="py-2 pr-3">System / data</th><th className="pr-3">File availability</th><th className="pr-3">Possible copying</th><th>How sure?</th></tr></thead>
      <tbody>{d.scope.map((s) => <tr key={s.id} className="border-b align-top last:border-0">
        <td className="py-3 pr-3"><div className="font-medium">{s.system}</div><div className="text-xs text-muted-foreground">{s.data_category}{s.matter_code ? ` · ${s.matter_code}` : ""}</div>
          {s.notes && <div className="mt-1 max-w-xs text-xs text-muted-foreground">{s.notes}</div>}
          <div className="text-[11px] text-muted-foreground">Updated {fmtTime(s.updated_at)}{s.updated_by_name ? ` by ${s.updated_by_name}` : ""}</div></td>
        {(["availability", "copying", "certainty"] as const).map((k) => <td key={k} className="py-3 pr-3">
          <select aria-label={`${k} for ${s.system} ${s.data_category}`} className={field} value={s[k]} disabled={!!busy}
            onChange={(e) => void run("scope", () => api.updateScope(id, s.id, { [k]: e.target.value }))}>
            {Object.entries(LABELS[k]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select></td>)}
      </tr>)}</tbody></table></div>
    {adding ? <form className="grid gap-2 md:grid-cols-5" onSubmit={(e) => { e.preventDefault();
      void run("add-scope", () => api.addScope(id, f), "Scope added").then((ok) => { if (ok) { setF(blank); setAdding(false); } }); }}>
      <input required placeholder="System (e.g. Billing)" aria-label="System" className={field} value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })} />
      <input required placeholder="Data (e.g. Invoices)" aria-label="Data category" className={field} value={f.data_category} onChange={(e) => setF({ ...f, data_category: e.target.value })} />
      {(["availability", "copying", "certainty"] as const).map((k) => <select key={k} aria-label={`New scope ${k}`} className={field} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        {Object.entries(LABELS[k]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>)}
      <div className="flex gap-2 md:col-span-5"><Button disabled={!!busy}>Add</Button><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
    </form> : <Button variant="outline" size="sm" onClick={() => setAdding(true)}>+ Add affected data</Button>}
  </div>;
}

// ---------- incident-level AI triage -> approval -> Photon alert ----------
function Triage({ d, id, run, busy }: { d: IncidentDetail; id: string; run: Run; busy: string | null }) {
  const t = d.triage;
  const [to, setTo] = useState<number | "">("");
  const users = useQuery({ queryKey: ["vigil", "users"], queryFn: api.users, staleTime: 30_000, retry: false });
  const recipients = (users.data ?? []).filter((u) => u.active && u.alert_opt_in);
  return <section className="space-y-3 rounded-lg border bg-card p-5">
    <div className="flex items-center gap-2"><Bot className="h-5 w-5 text-brass" /><h2 className="text-xl">AI triage</h2>
      {t && <span className="ml-auto font-mono text-xs uppercase text-muted-foreground">{t.status}{t.is_mock ? " · mock, not live AI" : ""}</span>}</div>
    {(!t || t.status === "rejected" || t.status === "failed") && <>
      <p className="text-sm text-muted-foreground">Drafts a prioritized plan from the evidence and affected matters. Nothing happens until a person approves it.</p>
      {t?.status === "failed" && <p role="alert" className="text-sm text-threat">Triage failed — keep working manually. {t.error}</p>}
      <Button className="w-full" disabled={!!busy} onClick={() => void run("triage", () => api.runTriage(id))}>{busy === "triage" ? <><Loader2 className="animate-spin" />Running…</> : t ? "Run AI triage again" : "Run AI triage"}</Button>
    </>}
    {t && t.tool_calls.length > 0 && <ol className="space-y-1">{t.tool_calls.map((c) => <li key={c.step} className="flex gap-2 text-xs"><Wrench className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="font-mono">{c.tool}</span><span className="ml-auto text-right text-muted-foreground">{c.result_summary}</span></li>)}</ol>}
    {t?.draft && <div className="space-y-2 text-sm"><p>{t.draft.summary}</p>
      <ul className="space-y-2">{t.draft.tasks.map((x, i) => <li key={i} className="rounded border p-2"><div className="font-medium">{x.title}</div>
        <div className="text-xs text-muted-foreground">{x.owner_role} · due {fmtTime(x.due_at)} · {LABELS.severity[x.priority]}{x.evidence_refs.length ? ` · ${x.evidence_refs.join(", ")}` : ""}</div></li>)}</ul>
      {t.draft.unknowns.length > 0 && <ul className="list-disc pl-5 text-risk">{t.draft.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>}</div>}
    {t?.status === "draft" && <div className="flex gap-2">
      <Button className="flex-1" disabled={!!busy} onClick={() => void run("approve", () => api.decideTriage(id, t.id, "approve"), "Plan approved")}><Check />Approve plan</Button>
      <Button variant="outline" disabled={!!busy} onClick={() => void run("reject", () => api.decideTriage(id, t.id, "reject"))}><X />Reject</Button></div>}
    {t?.status === "approved" && <div className="space-y-2 border-t pt-3">
      <p className="text-sm text-healthy">Approved by {t.decided_by} at {fmtTime(t.decided_at)}</p>
      <p className="text-xs text-muted-foreground">Phone alert sends only the generic code {d.incident.code}. Client and case details stay in Vigil.</p>
      {recipients.length === 0 ? <p className="text-xs text-risk">No one has agreed to phone alerts yet. An admin can turn this on in Access.</p> :
        <div className="flex gap-2"><select aria-label="Alert recipient for approved plan" className={cn(field, "min-w-0 flex-1")} value={to} onChange={(e) => setTo(Number(e.target.value) || "")}>
          <option value="">Choose recipient…</option>{recipients.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.phone_masked})</option>)}</select>
          <Button variant="destructive" disabled={!!busy || !to} onClick={() => to && void run("notify", () => api.notify(id, to))}><Phone />Send alert</Button></div>}
    </div>}
    {d.notifications.length > 0 && <div className="space-y-2 border-t pt-3"><div className="text-xs uppercase tracking-wider text-muted-foreground">Alerts</div>
      {d.notifications.map((n) => <div key={n.id} className="rounded border p-2 text-xs">
        <div className="font-medium">{n.recipient_label} · {n.channel}{n.is_mock ? " · simulated (Photon off)" : " · Photon"}</div>
        <div className="text-muted-foreground">Provider: {n.send_status} · delivery: {n.delivery_status} · {n.acknowledged_at ? `acknowledged ${fmtTime(n.acknowledged_at)}` : "not acknowledged"}</div>
        {!n.acknowledged_at && <button className="mt-1 text-primary underline" disabled={!!busy} onClick={() => void run("ack", () => api.ackNotification(id, n.id), "Acknowledgement recorded")}>Record acknowledgement</button>}
      </div>)}</div>}
  </section>;
}

// ---------- Nemotron IT drafts (POST /incidents/{id}/it-requests, retry via /it-requests/{rid}/triage) ----------
function ITHelp({ id, d }: { id: string; d: IncidentDetail }) {
  const client = useQueryClient();
  const key = ["vigil", "it-requests", id];
  const list = useQuery({ queryKey: key, queryFn: () => api.itRequests(id), retry: false,
    refetchInterval: (q) => (q.state.data?.some((r) => r.triage.status === "running" || r.triage.status === "pending") ? 2000 : 10_000) });
  const [body, setBody] = useState("");
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState<number | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const filingIds = new Set(d.requests.map((r) => r.triage_id));

  const refresh = () => client.invalidateQueries({ queryKey: key });
  async function act(which: number | "new", fn: () => Promise<ITRequest>) {
    setBusy(which); setError(null);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : "Request failed"); }
    finally { setBusy(null); await refresh(); await client.invalidateQueries({ queryKey: ["vigil", "incident", id] }); }
  }
  return <section className="space-y-3 rounded-lg border bg-card p-5">
    <div className="flex items-center gap-2"><LifeBuoy className="h-5 w-5 text-brass" /><h2 className="text-xl">IT help · Nemotron draft</h2></div>
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); const v = body.trim(); if (!v) return;
      void act("new", () => api.submitITRequest(id, v, who.trim())).then(() => setBody("")); }}>
      <textarea aria-label="What's broken?" placeholder="What's broken? e.g. I can't open the exhibits" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} disabled={busy !== null} className="min-h-20 w-full rounded-md border bg-input/30 p-3 text-sm outline-none focus:border-ring" />
      <input aria-label="Your name or team (optional)" placeholder="Your name / team (optional)" maxLength={120} value={who} onChange={(e) => setWho(e.target.value)} disabled={busy !== null} className={cn(field, "w-full")} />
      <Button className="w-full" disabled={busy !== null || !body.trim()}>{busy === "new" ? <><Loader2 className="animate-spin" />Saved — Nemotron is drafting (up to a minute)…</> : "Send to IT"}</Button>
    </form>
    {error && <p role="alert" className="text-sm text-threat">{error}</p>}
    {list.error && <p role="alert" className="text-sm text-threat">IT requests could not load: {list.error.message}</p>}
    {list.data?.map((r) => <ITRequestCard key={r.id} r={r} fromFiling={filingIds.has(r.id)} busy={busy === r.id} disabled={busy !== null}
      onRetry={() => void act(r.id, () => api.retryITTriage(r.id))} />)}
  </section>;
}

function ITRequestCard({ r, fromFiling, busy, disabled, onRetry }: { r: ITRequest; fromFiling: boolean; busy: boolean; disabled: boolean; onRetry: () => void }) {
  const t = r.triage; const x = r.draft;
  return <div className="space-y-2 border-t pt-3 text-sm">
    <div className="text-xs text-muted-foreground">Request #{r.id}{fromFiling ? " · filing request" : ""} · saved {fmtTime(r.created_at)}{r.requester_label ? ` · ${r.requester_label}` : ""}</div>
    <p>“{r.body}”</p>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {t.status === "drafted" && <span className={cn("rounded-full border px-2 py-0.5 font-mono uppercase", t.is_live_nemotron ? "border-healthy/60 text-healthy" : "border-risk/60 text-risk")}>{t.is_live_nemotron ? "Live Nemotron" : "Fixture — not live AI"}</span>}
      <span className={t.status === "failed" ? "text-threat" : t.status === "drafted" ? "text-healthy" : "text-muted-foreground"}>{t.status === "drafted" ? "Draft ready" : t.status === "failed" ? "Triage failed" : "Triaging…"}</span>
      {t.model && <span className="text-muted-foreground">{t.model}</span>}
      {t.attempts > 1 && <span className="text-muted-foreground">attempt {t.attempts}</span>}
    </div>
    {t.status === "failed" && t.error && <p role="alert" className="text-threat">{t.error}</p>}
    {x && t.status === "drafted" && <div className="rounded border p-3">
      <div className="text-xs uppercase tracking-wider text-brass">{x.header}{x.notify_role ? ` · routed to ${x.notify_role}` : ""}</div><div className="font-medium">{x.title}</div>
      <dl className="mt-2 space-y-1.5"><Row label="Issue" value={x.issue} /><Row label="Deadline" value={x.deadline.text} warn={!x.deadline.known} />
        <Row label="Why it's urgent" value={x.why_urgent} /><Row label="First action" value={x.first_action} /><Row label="File copying" value={x.file_copying.label} /></dl>
      <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Evidence, unknowns and tool calls</summary>
        <p className="mt-1">Evidence: {x.evidence.map((e) => e.ref).join(", ") || "none"}</p>
        <p>Still unknown: {x.unknowns.join("; ") || "nothing flagged"}</p>
        <p>Tools: {t.tool_calls.map((c) => `${c.tool} (${c.result_summary})`).join(" → ")}</p>
        {t.validation.length > 0 && <p>Backend corrections: {t.validation.join("; ")}</p>}</details>
    </div>}
    {t.can_retry && <Button size="sm" variant="outline" disabled={disabled} onClick={onRetry}>{busy ? <Loader2 className="animate-spin" /> : <RotateCw />}{t.status === "failed" ? "Retry triage" : "Re-run with latest records"}</Button>}
  </div>;
}

/** What the lawyer sees for their filing request, from request to completion. */
export function requestLabel(r: FilingRequest): string {
  if (r.status === "done") return `Completed${r.owner_name ? ` by ${r.owner_name}` : ""} · File available`;
  if (r.status === "claimed") return `In progress · Assigned to ${r.owner_name ?? "IT"}`;
  if (r.status === "acknowledged") return "Acknowledged · Waiting for an owner";
  if (r.status === "task_ready") return r.alert_status === "accepted" ? "Waiting for IT · On-call IT texted" : "Waiting for IT";
  return r.triage_status === "failed" ? "Triage failed — request saved" : "Saved, routing to IT";
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return <div><dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt><dd className={warn ? "text-risk" : ""}>{value}</dd></div>;
}
function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return <details className="py-4" open={open}><summary className="cursor-pointer font-display text-xl">{title}</summary><div className="mt-4">{children}</div></details>;
}
function Fact({ icon: Icon, label, value }: { icon: typeof FileWarning; label: string; value: string }) {
  return <div className="flex min-w-0 gap-2"><Icon className="mt-1 h-4 w-4 shrink-0 text-brass" /><div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div></div>;
}
