import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Bot, Check, CheckCircle2, Clock, Loader2, MessageSquare, Phone, Send, Wrench, X } from "lucide-react";
import { get, patch, post, session } from "../api/client";
import { Badge, ErrorBanner, fmtTime, LABELS, SimulatedTag, Spinner, StaleBanner, usePoll } from "../components/ui";

type Tab = "scope" | "room" | "timeline";

export default function Incident() {
  const { id } = useParams();
  const { data, setData, error, stale } = usePoll(() => get(`/incidents/${id}`), 2000, [id]);
  const [tab, setTab] = useState<Tab>("scope");
  const [actionError, setActionError] = useState<string | null>(null);

  // Every mutation returns the full incident: replace local state with it.
  async function act(method: "POST" | "PATCH", path: string, body?: any) {
    setActionError(null);
    try {
      const d = method === "POST" ? await post(`/incidents/${id}${path}`, body) : await patch(`/incidents/${id}${path}`, body);
      setData(d);
      return d;
    } catch (e: any) {
      setActionError(e.message);
      return null;
    }
  }

  if (!data) return error ? <ErrorBanner message={error} /> : <Spinner />;
  const inc = data.incident;

  return (
    <div className="mx-auto max-w-7xl">
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Command Center
      </Link>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="font-mono">{inc.code}</span>
            {inc.source === "simulated" && <SimulatedTag />}
            <span>· opened {fmtTime(inc.created_at)}</span>
          </div>
          <h1 className="text-2xl font-bold text-navy-900">{inc.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge kind="severity" value={inc.severity} />
          <label className="sr-only" htmlFor="status">Status</label>
          <select id="status" className="input w-44" value={inc.status} onChange={(e) => act("PATCH", "", { status: e.target.value })}>
            {Object.entries(LABELS.status).map(([v, l]) => <option key={v} value={v}>Status: {l}</option>)}
          </select>
        </div>
      </header>

      {/* Headline chips: what's at risk, in plain words */}
      <div className="mb-5 flex flex-wrap gap-2">
        {data.headline.map((h: any) => (
          <Badge key={h.label} value={h.label} tone={h.tone} />
        ))}
      </div>
      <StaleBanner stale={stale} error={error} />
      <ErrorBanner message={actionError} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="mb-4 flex gap-1 rounded-lg bg-slate-200/60 p-1">
            {([["scope", "Scope"], ["room", `Response Room (${data.messages.length})`], ["timeline", "Timeline"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${tab === k ? "bg-white text-navy-900 shadow" : "text-slate-600 hover:text-slate-900"}`}>
                {l}
              </button>
            ))}
          </div>
          {tab === "scope" && <ScopeTab data={data} act={act} />}
          {tab === "room" && <RoomTab data={data} act={act} />}
          {tab === "timeline" && <TimelineTab data={data} />}
        </div>
        <TriagePanel data={data} act={act} />
      </div>
    </div>
  );
}

// ---------------- Scope ----------------
function ScopeTab({ data, act }: { data: any; act: Function }) {
  return (
    <div className="space-y-5">
      {data.matters_at_risk.length > 0 && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.matters_at_risk.map((m: any) => (
            <div key={m.matter_code} className={`card p-4 ${m.at_risk ? "border-red-200" : ""}`}>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-mono">{m.matter_code}</span>
                {m.is_simulated && <SimulatedTag />}
              </div>
              <div className="mt-1 font-semibold">{m.title}</div>
              {m.deadline_local && (
                <div className={`mt-2 flex items-center gap-1.5 text-sm font-semibold ${m.at_risk ? "text-red-700" : "text-slate-700"}`}>
                  <Clock className="h-4 w-4" /> {m.deadline_local} {m.deadline_label}
                </div>
              )}
              <div className="mt-1 text-xs text-slate-500">Lead: {m.lead_name} ({m.lead_role})</div>
            </div>
          ))}
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Affected data</h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">System / data</th>
              <th className="px-4 py-2">File availability</th>
              <th className="px-4 py-2">Possible data copying</th>
              <th className="px-4 py-2">How sure?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.scope.map((s: any) => (
              <tr key={s.id} className="align-top">
                <td className="px-4 py-3">
                  <div className="font-medium">{s.system}</div>
                  <div className="text-xs text-slate-500">{s.data_category}</div>
                  {s.notes && <div className="mt-1 max-w-xs text-xs text-slate-500">{s.notes}</div>}
                  <div className="mt-1 text-[11px] text-slate-400">Updated {fmtTime(s.updated_at)}{s.updated_by_name ? ` by ${s.updated_by_name}` : ""}</div>
                </td>
                {(["availability", "copying", "certainty"] as const).map((field) => (
                  <td key={field} className="px-4 py-3">
                    <Badge kind={field} value={s[field]} />
                    <select aria-label={`Change ${field}`} className="mt-2 block w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
                      value={s[field]} onChange={(e) => act("PATCH", `/scope/${s.id}`, { [field]: e.target.value })}>
                      {Object.entries(LABELS[field]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <AddScope act={act} />
      </section>

      <section className="card">
        <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Evidence</h2>
        <ul className="divide-y divide-slate-100">
          {data.evidence.length === 0 && <li className="p-5 text-sm text-slate-500">No evidence recorded yet.</li>}
          {data.evidence.map((e: any) => (
            <li key={e.id} id={e.ref} className="flex items-start gap-3 px-5 py-3 text-sm">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{e.ref}</span>
              <div className="flex-1">
                <div>{e.description}</div>
                <div className="text-xs text-slate-500">{fmtTime(e.observed_at)} · {e.kind.replace(/_/g, " ")}</div>
              </div>
              <Badge kind="certainty" value={e.certainty} />
              {e.is_simulated && <SimulatedTag />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function AddScope({ act }: { act: Function }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ system: "", data_category: "", availability: "unknown", copying: "unknown", certainty: "unknown" });
  if (!open)
    return (
      <button className="m-4 text-sm font-semibold text-navy-700 hover:underline" onClick={() => setOpen(true)}>
        + Add affected data
      </button>
    );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await act("POST", "/scope", f)) setOpen(false);
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3 border-t border-slate-100 p-4 md:grid-cols-5">
      <input className="input" required placeholder="System (e.g. Billing)" value={f.system} onChange={(e) => setF({ ...f, system: e.target.value })} />
      <input className="input" required placeholder="Data (e.g. Invoices)" value={f.data_category} onChange={(e) => setF({ ...f, data_category: e.target.value })} />
      {(["availability", "copying", "certainty"] as const).map((k) => (
        <select key={k} className="input" value={(f as any)[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
          {Object.entries(LABELS[k]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ))}
      <div className="col-span-full flex gap-2">
        <button className="btn-primary">Add</button>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------- Response Room ----------------
function RoomTab({ data, act }: { data: any; act: Function }) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const me = session.user;
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [data.messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    if (await act("POST", "/messages", { body })) setBody("");
    setSending(false);
  }

  return (
    <div className="space-y-5">
      <section className="card flex h-[420px] flex-col">
        <h2 className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 font-semibold">
          <MessageSquare className="h-4 w-4" /> Response Room
          <span className="ml-auto text-xs font-normal text-slate-500">Inside Vigil only. Not firm email.</span>
        </h2>
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {data.messages.length === 0 && <p className="text-sm text-slate-500">No messages yet. Say what you're working on.</p>}
          {data.messages.map((m: any) => {
            const mine = m.user_id === me?.id;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : ""}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${mine ? "bg-navy-700 text-white" : "bg-slate-100"}`}>
                  <div className={`mb-0.5 text-xs ${mine ? "text-slate-300" : "text-slate-500"}`}>
                    {m.user_name}{m.team_role ? ` · ${m.team_role}` : ""} · {fmtTime(m.created_at)}
                  </div>
                  {m.body}
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
        <form onSubmit={send} className="flex gap-2 border-t border-slate-100 p-3">
          <input className="input" placeholder="Type an update, e.g. “Backup copy located.”" value={body} onChange={(e) => setBody(e.target.value)} />
          <button className="btn-primary" disabled={sending || !body.trim()}>
            <Send className="h-4 w-4" /> Send
          </button>
        </form>
      </section>
      <TasksCard data={data} act={act} />
    </div>
  );
}

function TasksCard({ data, act }: { data: any; act: Function }) {
  return (
    <section className="card">
      <h2 className="border-b border-slate-100 px-5 py-3 font-semibold">Tasks ({data.counts.open_tasks} open)</h2>
      <ul className="divide-y divide-slate-100">
        {data.tasks.length === 0 && <li className="p-5 text-sm text-slate-500">No tasks yet. Run AI triage or add one.</li>}
        {data.tasks.map((t: any) => (
          <li key={t.id} className="flex items-start gap-3 px-5 py-3 text-sm">
            <input type="checkbox" aria-label="Mark done" className="mt-1 h-4 w-4" checked={t.status === "done"}
              onChange={(e) => act("PATCH", `/tasks/${t.id}`, { status: e.target.checked ? "done" : "open" })} />
            <div className="flex-1">
              <div className={t.status === "done" ? "text-slate-400 line-through" : "font-medium"}>{t.title}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {t.owner_name ?? t.owner_label ?? "Unassigned"} · due {fmtTime(t.due_at)}
                {t.evidence_refs.length > 0 && <> · evidence {t.evidence_refs.map((r: string) => <a key={r} href={`#${r}`} className="ml-1 font-mono text-navy-700 underline">{r}</a>)}</>}
                {t.source === "ai" && <> · AI-drafted, approved by {t.approved_by_name}</>}
              </div>
            </div>
            <Badge kind="severity" value={t.priority} />
            <Badge kind="task" value={t.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------- Timeline ----------------
function TimelineTab({ data }: { data: any }) {
  return (
    <section className="card p-5">
      <ol className="relative ml-2 border-l-2 border-slate-200">
        {[...data.timeline].reverse().map((e: any) => (
          <li key={e.id} className="mb-4 ml-5">
            <span className="absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-navy-600" />
            <div className="text-xs text-slate-500">
              {new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}
              {" · "}{e.actor_name ?? "System"} · <span className="font-mono">{e.kind}</span>
            </div>
            <div className="text-sm">{e.summary}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------- AI Triage panel ----------------
function TriagePanel({ data, act }: { data: any; act: Function }) {
  const t = data.triage;
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [recipient, setRecipient] = useState<number | "">("");

  useEffect(() => {
    get("/users").then((us) => setRecipients(us.filter((u: any) => u.active && u.alert_opt_in))).catch(() => {});
  }, [t?.status]);

  async function run() {
    setRunning(true);
    await act("POST", "/triage");
    setRunning(false);
  }
  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    await act("POST", "/approve", { triage_id: t.id, decision });
    setBusy(false);
  }
  async function sendAlert() {
    if (!recipient) return;
    setBusy(true);
    await act("POST", "/notify", { recipient_user_id: recipient, channel: "imessage" });
    setBusy(false);
  }

  return (
    <aside className="card h-fit p-5">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="h-5 w-5 text-navy-700" />
        <h2 className="font-semibold">AI Triage</h2>
        {t?.is_mock && <SimulatedTag />}
        {t && <span className="ml-auto"><Badge value={t.status} tone={t.status === "approved" ? "ok" : t.status === "failed" ? "critical" : "info"} /></span>}
      </div>

      {(!t || ["rejected", "failed"].includes(t.status)) && (
        <>
          <p className="mb-3 text-sm text-slate-600">
            The AI reads the evidence and affected matters, then drafts a prioritized plan. Nothing happens until a person approves it.
          </p>
          {t?.status === "failed" && <ErrorBanner message={`AI triage failed. Keep working manually. (${t.error})`} />}
          <button className="btn-primary w-full justify-center" onClick={run} disabled={running}>
            {running ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</> : "Run AI triage"}
          </button>
        </>
      )}

      {t && t.tool_calls?.length > 0 && (
        <div className="mt-4">
          <div className="label">Tool activity</div>
          <ol className="space-y-1.5">
            {t.tool_calls.map((c: any) => (
              <li key={c.step} className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
                <Wrench className="h-3.5 w-3.5 text-slate-500" />
                <span className="font-mono">{c.tool}</span>
                <span className="ml-auto text-slate-500">{c.result_summary}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {t?.draft && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-700">{t.draft.summary}</p>
          <div>
            <div className="label">Proposed tasks</div>
            <ul className="space-y-2">
              {t.draft.tasks.map((d: any, i: number) => (
                <li key={i} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="font-medium">{d.title}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {d.owner_role} · due {fmtTime(d.due_at)} · {LABELS.severity[d.priority]}
                    {d.evidence_refs?.length > 0 && <> · {d.evidence_refs.join(", ")}</>}
                  </div>
                  {d.rationale && <div className="mt-1 text-xs italic text-slate-500">{d.rationale}</div>}
                </li>
              ))}
            </ul>
          </div>
          {t.draft.unknowns?.length > 0 && (
            <div>
              <div className="label">Still unknown</div>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-amber-900">
                {t.draft.unknowns.map((u: string) => <li key={u}>{u}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {t?.status === "draft" && (
        <div className="mt-4 flex gap-2">
          <button className="btn-primary flex-1 justify-center" onClick={() => decide("approve")} disabled={busy}>
            <Check className="h-4 w-4" /> Approve plan
          </button>
          <button className="btn-ghost" onClick={() => decide("reject")} disabled={busy}>
            <X className="h-4 w-4" /> Reject
          </button>
        </div>
      )}

      {t?.status === "approved" && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="mb-2 flex items-center gap-1.5 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4" /> Approved by {t.decided_by} at {fmtTime(t.decided_at)}
          </div>
          <div className="label">Send phone alert</div>
          <p className="mb-2 text-xs text-slate-500">Sends only a generic code ({data.incident.code}). Client and case details stay in Vigil.</p>
          {recipients.length === 0 ? (
            <p className="text-xs text-amber-800">No one has agreed to phone alerts yet. An admin can turn this on in Access.</p>
          ) : (
            <div className="flex gap-2">
              <select className="input" value={recipient} onChange={(e) => setRecipient(Number(e.target.value) || "")}>
                <option value="">Choose recipient…</option>
                {recipients.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.phone_masked})</option>)}
              </select>
              <button className="btn-danger shrink-0 whitespace-nowrap" onClick={sendAlert} disabled={busy || !recipient}>
                <Phone className="h-4 w-4" /> Send alert
              </button>
            </div>
          )}
        </div>
      )}

      {data.notifications.length > 0 && (
        <div className="mt-4 space-y-2">
          <div className="label">Alerts</div>
          {data.notifications.map((n: any) => (
            <div key={n.id} className="rounded-lg border border-slate-200 p-3 text-xs">
              <div className="mb-1.5 flex items-center gap-2 font-medium">
                {n.recipient_label} · {n.channel} {n.is_mock && <SimulatedTag />}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge kind="send" value={n.send_status} />
                <Badge kind="delivery" value={n.delivery_status} tone={n.delivery_status === "delivered" ? "ok" : "neutral"} />
                <Badge value={n.acknowledged_at ? `Acknowledged ${fmtTime(n.acknowledged_at)}` : "Not acknowledged"}
                  tone={n.acknowledged_at ? "ok" : "neutral"} />
              </div>
              {!n.acknowledged_at && (
                <button className="mt-2 text-navy-700 underline" onClick={() => act("POST", `/notifications/${n.id}/ack`)}>
                  Record acknowledgement
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
