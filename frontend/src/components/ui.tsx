import { useCallback, useEffect, useRef, useState } from "react";
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
  critical: "bg-red-50 text-red-800 ring-red-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  info: "bg-blue-50 text-blue-800 ring-blue-200",
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
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
  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-800">
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
    <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {message}
    </div>
  );
}

export function StaleBanner({ stale, error }: { stale: boolean; error: string | null }) {
  if (!stale && !error) return null;
  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      {stale ? "Live updates paused. What you see may be out of date. Retrying…" : `Update failed: ${error}`}
    </div>
  );
}
