import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2 } from "lucide-react";

// ---- polling hook: live updates every 2 s, with a stale-data flag ----
export function usePoll<T>(fn: () => Promise<T>, intervalMs = 2000, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number>(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(async () => {
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
      setLastOk(Date.now());
    } catch (e: any) {
      setError(e.message ?? "Update failed");
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    // Browsers slow timers in background tabs: refresh immediately when the user comes back.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const stale = !!lastOk && Date.now() - lastOk > intervalMs * 3;
  return { data, setData, error, stale, refresh };
}

// ---- human labels for every enum (status color is always paired with text) ----
export const LABELS: Record<string, Record<string, string>> = {
  availability: { available: "Available", degraded: "Degraded", locked: "Locked", destroyed: "Destroyed", unknown: "Unknown" },
  copying: { none_observed: "No copying observed", suspected: "Copying suspected", confirmed: "Copying confirmed", unknown: "Copying unverified" },
  certainty: { observed: "Observed", confirmed: "Confirmed", unknown: "Unknown" },
  status: { open: "Open", investigating: "Investigating", contained: "Contained", recovering: "Recovering", closed: "Closed" },
  task: { open: "Open", in_progress: "In progress", done: "Done", blocked: "Blocked" },
  severity: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
  send: { pending: "Sending…", accepted: "Accepted by provider", failed: "Send failed", unknown: "Outcome unknown" },
  delivery: { unconfirmed: "Delivery unconfirmed", delivered: "Delivered", undeliverable: "Undeliverable" },
};

type Tone = "critical" | "warning" | "ok" | "info" | "neutral";
const TONE: Record<Tone, string> = {
  critical: "bg-red-500/15 text-red-300 ring-red-500/30",
  warning: "bg-amber-400/10 text-amber-200 ring-amber-400/25",
  ok: "bg-lime-soft text-lime ring-lime/30",
  info: "bg-sky-400/10 text-sky-200 ring-sky-400/25",
  neutral: "bg-white/5 text-muted ring-white/10",
};
const TONE_OF: Record<string, Tone> = {
  locked: "critical", destroyed: "critical", confirmed: "critical", critical: "critical", failed: "critical",
  degraded: "warning", suspected: "warning", unknown: "warning", high: "warning", blocked: "warning", open: "warning",
  available: "ok", none_observed: "ok", done: "ok", accepted: "ok", delivered: "ok", contained: "ok", closed: "neutral",
  in_progress: "info", investigating: "info", recovering: "info", observed: "info",
};

export function Badge({ kind, value, tone }: { kind?: string; value: string; tone?: Tone }) {
  const t = tone ?? TONE_OF[value] ?? "neutral";
  const text = (kind && LABELS[kind]?.[value]) ?? value;
  const Icon = t === "critical" ? AlertTriangle : t === "ok" ? CheckCircle2 : t === "warning" ? CircleHelp : null;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE[t]}`}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {text}
    </span>
  );
}

export const SimulatedTag = () => (
  <span className="rounded-full bg-violet-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-violet-300">
    Simulated
  </span>
);

export function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {message}
    </div>
  );
}

export function StaleBanner({ stale, error }: { stale: boolean; error: string | null }) {
  if (!stale && !error) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-2 text-sm text-amber-200">
      {stale ? "Live updates paused. What you see may be out of date. Retrying…" : `Update failed: ${error}`}
    </div>
  );
}

// ---- big number tile, like the reference's KPI cards ----
export function StatTile({ icon, label, value, note, tone = "neutral" }:
  { icon: React.ReactNode; label: string; value: React.ReactNode; note?: string; tone?: "critical" | "warning" | "ok" | "neutral" }) {
  const noteColor = { critical: "text-red-300", warning: "text-amber-200", ok: "text-lime", neutral: "text-muted" }[tone];
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-panel2 text-ink">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm text-muted">{label}</div>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        {note && <div className={`text-xs ${noteColor}`}>{note}</div>}
      </div>
    </div>
  );
}

// ---- the 6 steps of a response, worked out from the incident payload ----
export type Step = { key: string; title: string; done: boolean; hint: string };

export function responseSteps(d: any): Step[] {
  const t = d?.triage;
  const sent = (d?.notifications ?? []).some((n: any) => n.send_status === "accepted");
  const status = d?.incident?.status;
  return [
    { key: "detect", title: "Detect", done: !!d, hint: "Open an incident or run Simulate attack." },
    { key: "scope", title: "Assess scope", done: (d?.scope ?? []).length > 0,
      hint: "Record which systems and data are affected (Scope tab)." },
    { key: "plan", title: "AI plan", done: !!t && ["draft", "approved"].includes(t.status),
      hint: "Click Run AI triage to get a prioritized plan." },
    { key: "approve", title: "Approve", done: t?.status === "approved",
      hint: "Review the AI plan and click Approve plan." },
    { key: "alert", title: "Alert team", done: sent, hint: "Send a phone alert to the on-call responder." },
    { key: "recover", title: "Contain & recover", done: ["contained", "recovering", "closed"].includes(status),
      hint: "Work the tasks, post updates in the Response Room, then set status to Contained." },
  ];
}

export function Stepper({ steps }: { steps: Step[] }) {
  const next = steps.findIndex((s) => !s.done);
  return (
    <ol className="grid grid-cols-3 gap-2 md:grid-cols-6">
      {steps.map((s, i) => {
        const state = s.done ? "done" : i === next ? "next" : "todo";
        return (
          <li key={s.key} className={`rounded-2xl border px-3 py-2.5 ${
            state === "done" ? "border-lime/30 bg-lime-soft" : state === "next" ? "border-accent bg-accent-soft" : "border-line bg-panel2"}`}>
            <div className={`text-[11px] font-semibold uppercase tracking-wider ${
              state === "done" ? "text-lime" : state === "next" ? "text-accent" : "text-faint"}`}>
              {state === "done" ? "✓ Done" : state === "next" ? "→ Next" : `Step ${i + 1}`}
            </div>
            <div className={`text-sm font-medium ${state === "todo" ? "text-muted" : "text-ink"}`}>{s.title}</div>
          </li>
        );
      })}
    </ol>
  );
}
