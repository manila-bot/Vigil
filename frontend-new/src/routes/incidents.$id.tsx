import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Bot, CalendarClock, CircleDashed, FileWarning, Hand, Send, UserRound } from "lucide-react";
import { AppShell } from "@/components/vigil/AppShell";
import { FirmMap } from "@/components/vigil/FirmMap";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LiveIncident } from "@/components/vigil/LiveIncident";
import { EVIDENCE, TOOL_CALLS, useCurrentUser, requestDisplayStatus } from "@/lib/vigil";
import { useIncident } from "@/lib/incident";
import { USE_MOCKS } from "@/lib/api";

export const Route = createFileRoute("/incidents/$id")({
  head: ({ params }) => ({ meta: [
    { title: `${params.id} — Incident Workspace — Vigil` }, { name: "description", content: "Filing deadline, file availability, task ownership and shared incident response." },
    { property: "og:title", content: `${params.id} — Vigil` }, { property: "og:description", content: "Shared incident workspace for counsel and IT." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }), component: Workspace,
});
function Workspace() {
  const { id } = Route.useParams();
  return USE_MOCKS ? <SampleWorkspace id={id} /> : <AppShell><div className="mx-auto max-w-6xl"><LiveIncident id={id} /></div></AppShell>;
}

/** Sample mode only (VITE_USE_MOCKS=1): fictional scenario from src/lib/vigil.ts. */
function SampleWorkspace({ id }: { id: string }) {
  const incident = useIncident(); const me = useCurrentUser();
  const [open, setOpen] = useState(false); const [files, setFiles] = useState("Exhibits for Calloway v. Brightline court filing");
  const [draft, setDraft] = useState(""); const [busy, setBusy] = useState<"request" | "claim" | "post" | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const task = incident.task;
  const status = requestDisplayStatus(incident.request.status, { exists: task.exists, owner: task.owner });
  const run = async (kind: "request" | "claim" | "post", action: () => Promise<void>, success: () => void) => {
    setBusy(kind); try { await action(); success(); } catch (err) { toast.error(err instanceof Error ? err.message : "Unable to complete this action."); } finally { setBusy(null); }
  };
  return <AppShell><div className="mx-auto max-w-6xl space-y-6">
    {!incident.active ?
      <section className="space-y-4 border-y py-10"><h1 className="text-2xl">{id}: no active incident</h1><Button asChild><Link to="/incidents">Report incident</Link></Button></section> : <>
      <section className="space-y-5 border-b border-threat/50 pb-6">
        <div className="flex flex-wrap gap-2 font-mono text-xs"><span className="text-brass">{id}</span><span className="text-threat">Active incident · sample data</span></div>
        <h1 className="text-3xl">{incident.title}</h1>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact icon={CalendarClock} label="Filing deadline" value={incident.deadline} />
          <Fact icon={FileWarning} label="File availability" value={incident.availability} />
          <Fact icon={CircleDashed} label="Data copying" value={incident.copying} />
          <Fact icon={UserRound} label="Task owner" value={task.owner ?? (task.exists ? "Unclaimed" : "No task yet")} />
        </dl>
        <div className="flex flex-wrap items-start gap-5 border-t pt-4">
          {me?.role === "lawyer" && <div className="space-y-2">
            {!incident.request.started && !submitted ? <Button onClick={() => setOpen(true)}><Hand />Request IT help</Button> : <div role="status" className="font-medium text-primary">{busy === "request" ? "Submitting" : status}</div>}
            {incident.request.text && (incident.request.started || submitted) && <p className="max-w-xl text-sm text-muted-foreground">Requested files: {incident.request.text}</p>}
          </div>}
          {task.exists && <div className="min-w-0 flex-1 space-y-2">
            <h2 className="text-xl">Recovery task</h2><p className="text-sm">{task.title ?? "Recovery task details not provided"}</p>
            <p className="text-sm text-muted-foreground">File recovery: {task.recovery ?? "Not provided"}</p>
            {!task.owner && task.canClaim && <Button disabled={!!busy} onClick={() => void run("claim", incident.claim, () => toast.success("Task claimed"))}><Hand />{busy === "claim" ? "Claiming…" : "Claim task"}</Button>}
            {task.owner && <p className="font-medium text-healthy">Owned by {task.owner}</p>}
          </div>}
        </div>
      </section>
      <section className="space-y-3"><h2 className="text-xl">Response room</h2>
        <div className="flex h-72 flex-col border-y">
          <div className="flex-1 space-y-3 overflow-auto py-4 text-sm" aria-live="polite">
            {!incident.messages.length && <p className="text-muted-foreground">No updates yet.</p>}
            {incident.messages.map((m) => <div key={m.id}><div className="text-xs"><strong>{m.author}</strong><span className="ml-2 text-muted-foreground">{Number.isFinite(m.at) ? new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span></div><p className="whitespace-pre-wrap break-words">{m.text}</p></div>)}
          </div>
          <form className="flex gap-2 border-t py-3" onSubmit={(e) => { e.preventDefault(); const sent = draft; if (!sent.trim()) return; void run("post", () => incident.post(sent), () => setDraft((current) => current === sent ? "" : current)); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Post an update…" aria-label="Post an update" className="min-w-0 flex-1 rounded-md border bg-input/30 px-3 py-2 text-sm outline-none focus:border-ring" />
            <Button size="icon" aria-label="Send" title="Send update" disabled={!!busy || !draft.trim()}><Send /></Button>
          </form>
        </div>
      </section>
      <div className="space-y-0 divide-y border-y">
        <details className="py-4"><summary className="cursor-pointer font-display text-xl">Impact map</summary><div className="mt-4"><FirmMap attack onSelect={() => {}} /></div></details>
        <details className="py-4"><summary className="cursor-pointer font-display text-xl">Evidence</summary><div className="mt-4 space-y-3 text-sm">{EVIDENCE.map((e) => <div key={e.id}><div className="font-mono text-xs text-brass">{e.id} · {e.source}</div><p>{e.summary}</p></div>)}</div></details>
        <details className="py-4"><summary className="cursor-pointer font-display text-xl">Nemotron details</summary><div className="mt-4 space-y-3 text-sm">{incident.request.status === "Recommendation ready" ? <><div className="flex items-center gap-2 text-brass"><Bot />Sample recommendation</div><h3 className="text-xl">Find a verified clean copy of the filing exhibits</h3><ol className="space-y-2">{TOOL_CALLS.map((t) => <li key={t.name}><div className="font-mono text-xs text-primary">{t.name}</div><p>{t.summary}</p></li>)}</ol></> : <p className="text-muted-foreground">No recommendation available.</p>}</div></details>
      </div>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md"><DialogTitle>Request IT help</DialogTitle><DialogDescription>Confirm needed files</DialogDescription>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!files.trim()) return; void run("request", () => incident.requestHelp(files.trim()), () => { setSubmitted(true); setOpen(false); }); }}>
          <label className="block space-y-2 text-sm"><span>Files needed for filing</span><textarea aria-label="Files needed for filing" required value={files} onChange={(e) => setFiles(e.target.value)} className="min-h-24 w-full rounded-md border bg-input/30 p-3 outline-none focus:border-ring" /></label>
          <Button disabled={!!busy || !files.trim()}>{busy === "request" ? "Submitting…" : "Submit request"}</Button>
        </form>
      </DialogContent></Dialog>
    </>}
  </div></AppShell>;
}
function Fact({ icon: Icon, label, value }: { icon: typeof FileWarning; label: string; value: string }) {
  return <div className="flex min-w-0 gap-2"><Icon className="mt-1 h-4 w-4 shrink-0 text-brass" /><div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div></div>;
}
