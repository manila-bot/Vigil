import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useVigil, type Role } from "@/lib/vigil-store";
import { api, session, type FilingRequest, type TimelineEvent } from "@/lib/api";

export function Panel({
  title,
  sub,
  right,
  children,
  className = "",
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`border bg-card/60 p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em]">
          ◆ {title} {sub && <span className="text-muted-foreground">{sub}</span>}
        </p>
        {right}
      </div>
      {children}
    </section>
  );
}

const STATUS = {
  saved: "Submitted",
  task_ready: "Waiting for IT",
  acknowledged: "Acknowledged",
  claimed: "In progress",
  done: "Completed",
};

export function StatusPill({ r }: { r: FilingRequest }) {
  return (
    <span className="inline-block border border-primary px-2 py-0.5 font-mono text-[10px] uppercase text-primary">
      {STATUS[r.status]}
    </span>
  );
}

export function Btn({
  children,
  tone = "primary",
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "danger" | "safe" | "ghost";
}) {
  const t = {
    primary: "border-primary text-primary hover:bg-primary/10",
    danger: "border-destructive text-destructive hover:bg-destructive/10",
    safe: "border-safe text-safe hover:bg-safe/10",
    ghost: "border-border text-muted-foreground hover:text-foreground",
  }[tone];
  return (
    <button
      {...p}
      className={`border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors disabled:opacity-30 ${t} ${p.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function ActivityList({ items }: { items: TimelineEvent[] }) {
  return (
    <ol className="space-y-2 font-mono text-xs">
      {items.map((event) => (
        <li key={event.id}>
          {new Date(event.at).toLocaleString()} · {event.summary}
        </li>
      ))}
    </ol>
  );
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const v = useVigil();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  if (v.role !== role) return <Navigate to="/sign-in/$role" params={{ role }} replace />;
  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-3 font-mono text-xs">
        Signed in as {v.user?.name}
        <button
          onClick={async () => {
            try {
              await api.logout();
            } catch {
              /* End the local session even if the server is unavailable. */
            } finally {
              session.clear();
            }
          }}
          className="text-primary hover:underline"
        >
          Sign out
        </button>
      </div>
      {v.loading ? <p>Loading incident…</p> : children}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const v = useVigil();
  return (
    <div className={`min-h-screen font-sans ${v.detail ? "animate-alarm" : ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-3">
        <Link to="/" className="text-lg font-semibold tracking-[0.15em]">
          VIGIL
        </Link>
        {v.role === "admin" && (
          <Link to="/access" className="text-primary">
            Manage access
          </Link>
        )}
        {v.detail && (
          <span className="font-mono text-xs text-destructive">
            {v.detail.incident.code} · Active incident
          </span>
        )}
      </header>
      <main className="mx-auto max-w-7xl p-5">
        {v.error && (
          <p role="alert" className="mb-4 text-destructive">
            {v.error}
          </p>
        )}
        {children}
      </main>
    </div>
  );
}

export function PageTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-primary">{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  );
}
