// Request IT help -> Nemotron IT task draft. Live API only (POST /api/incidents/{id}/it-requests).
import { FormEvent, useEffect, useState } from "react";
import { LifeBuoy, Loader2, RotateCw } from "lucide-react";
import { get, post, USE_MOCKS } from "../api/client";
import { Badge, ErrorBanner, fmtTime } from "./ui";

type ITRequest = {
  id: number;
  body: string;
  requester_label: string | null;
  created_at: string;
  triage: {
    status: "pending" | "running" | "drafted" | "failed";
    can_retry: boolean;
    error: string | null;
    attempts: number;
    provider: string | null;
    is_live_nemotron: boolean;
    model: string | null;
    tool_calls: { step: number; tool: string; result_summary: string }[];
  };
  draft: null | {
    header: string;
    title: string;
    urgency: string;
    issue: string;
    deadline: { known: boolean; text: string };
    why_urgent: string;
    first_action: string;
    evidence: { ref: string; description: string }[];
    file_copying: { label: string };
    unknowns: string[];
  };
};

export default function ITHelpPanel({ incidentId }: { incidentId: number }) {
  const [body, setBody] = useState("");
  const [who, setWho] = useState("");
  const [req, setReq] = useState<ITRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show the latest saved request for this incident (survives reloads and failed triage).
  useEffect(() => {
    if (USE_MOCKS) return;
    get<ITRequest[]>(`/incidents/${incidentId}/it-requests`).then((rs) => setReq(rs[0] ?? null)).catch(() => {});
  }, [incidentId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await post<ITRequest>(`/incidents/${incidentId}/it-requests`, {
        body: body.trim(),
        requester_label: who.trim() || undefined,
      });
      setReq(r);
      setBody("");
    } catch (err: any) {
      setError(err.message);
      // The request may have been saved even if the response failed: reload it.
      get<ITRequest[]>(`/incidents/${incidentId}/it-requests`).then((rs) => rs[0] && setReq(rs[0])).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!req) return;
    setBusy(true);
    setError(null);
    try {
      setReq(await post<ITRequest>(`/it-requests/${req.id}/triage`));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (USE_MOCKS) {
    return (
      <section className="card p-5">
        <Title />
        <p className="text-sm text-muted">Request IT help works in live API mode only. Run <code>npm run dev</code> with the backend.</p>
      </section>
    );
  }

  const t = req?.triage;
  const d = req?.draft;
  return (
    <section className="card p-5">
      <Title />
      <form onSubmit={submit} className="space-y-2">
        <label className="label" htmlFor="it-body">What's broken?</label>
        <textarea id="it-body" className="input" rows={2} placeholder="e.g. I can't open the exhibits"
          value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} />
        <input className="input" placeholder="Your name / team (optional)" value={who}
          onChange={(e) => setWho(e.target.value)} disabled={busy} />
        <button className="btn-primary w-full" disabled={busy || !body.trim()}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Nemotron is drafting the IT task… (up to a minute)</> : "Request IT help"}
        </button>
      </form>
      <ErrorBanner message={error} />

      {req && t && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {/* The saved request is always shown, even when triage failed */}
          <div className="rounded-2xl bg-panel2 px-4 py-3 text-sm">
            <div className="text-xs text-faint">
              Request #{req.id} · saved {fmtTime(req.created_at)}{req.requester_label ? ` · ${req.requester_label}` : ""}
            </div>
            <div className="mt-0.5">“{req.body}”</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {t.status === "drafted" && (t.is_live_nemotron
              ? <span className="rounded-full bg-lime-soft px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-lime">Live Nemotron</span>
              : <span className="rounded-full bg-violet-400/15 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-violet-300">Fixture, not live AI</span>)}
            <Badge value={t.status === "drafted" ? "Draft ready" : t.status === "failed" ? "Triage failed" : "Triaging…"}
              tone={t.status === "drafted" ? "ok" : t.status === "failed" ? "critical" : "info"} />
            {t.model && t.status === "drafted" && <span className="text-[11px] text-faint">{t.model}</span>}
          </div>

          {t.status === "failed" && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {t.error}
              {t.can_retry && (
                <button className="btn-ghost mt-3 w-full" onClick={retry} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />} Retry triage
                </button>
              )}
            </div>
          )}

          {t.status === "drafted" && d && (
            <div className="rounded-2xl border border-line p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-accent">{d.header}</div>
              <div className="mt-1 text-base font-semibold leading-snug">{d.title}</div>
              <dl className="mt-3 space-y-2.5 text-sm">
                <Row label="Issue" value={d.issue} />
                <Row label="Deadline" value={d.deadline.text} strong={d.deadline.known} warn={!d.deadline.known} />
                <Row label="Why it's urgent" value={d.why_urgent} />
                <Row label="First action" value={d.first_action} strong />
              </dl>
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer text-faint">Evidence, unknowns and tool calls</summary>
                <div className="mt-2 space-y-1.5">
                  <div><span className="text-faint">Evidence:</span> {d.evidence.map((e) => e.ref).join(", ") || "none"}</div>
                  <div><span className="text-faint">File copying:</span> {d.file_copying.label}</div>
                  <div><span className="text-faint">Still unknown:</span> {d.unknowns.join("; ") || "nothing flagged"}</div>
                  <div><span className="text-faint">Tools:</span> {t.tool_calls.map((c) => `${c.tool} (${c.result_summary})`).join(" → ")}</div>
                </div>
              </details>
              {t.can_retry && (
                <button className="mt-3 text-xs text-faint underline hover:text-muted" onClick={retry} disabled={busy}>
                  Re-run triage (uses the latest incident records)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Title() {
  return (
    <div className="mb-3 flex items-center gap-2">
      <LifeBuoy className="h-5 w-5 text-accent" />
      <h2 className="font-semibold">Request IT help</h2>
    </div>
  );
}

function Row({ label, value, strong, warn }: { label: string; value: string; strong?: boolean; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</dt>
      <dd className={warn ? "text-amber-200" : strong ? "font-medium text-ink" : "text-muted"}>{value}</dd>
    </div>
  );
}
