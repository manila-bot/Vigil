import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, fmtTime } from "@/lib/api";
import { useVigil } from "@/lib/vigil-store";
import { Btn, PageTitle, Panel, RequireRole, StatusPill } from "@/components/vigil-ui";

export const Route = createFileRoute("/lawyer")({
  component: () => (
    <RequireRole role="lawyer">
      <Lawyer />
    </RequireRole>
  ),
});

function Lawyer() {
  const { detail, user, refresh } = useVigil();
  const [matterCode, setMatterCode] = useState("");
  const [file, setFile] = useState("");
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const matters = detail?.matters_at_risk.filter((matter) => matter.deadline_at) ?? [];
  const requests = detail?.requests.filter((request) => request.requester_id === user?.id) ?? [];
  const eligible = matters.filter(
    (matter) => !requests.some((request) => request.matter_code === matter.matter_code),
  );
  const selected = eligible.find((matter) => matter.matter_code === matterCode) ?? eligible[0];
  const input = "w-full border bg-background px-3 py-2 text-sm";

  return (
    <>
      <PageTitle eyebrow="Lawyer workspace" title={`Welcome, ${user?.name}`}>
        {detail && (
          <Link
            className="text-primary"
            to="/incidents/$id"
            params={{ id: String(detail.incident.id) }}
          >
            Open incident workspace
          </Link>
        )}
      </PageTitle>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Active cases">
          {matters.length === 0 && <p>No affected filing deadlines.</p>}
          <ul className="divide-y">
            {matters.map((matter) => (
              <li className="py-3 text-sm" key={matter.matter_code}>
                {matter.matter_code} · {matter.title}
                <div className="text-accent">
                  {matter.deadline_local ?? fmtTime(matter.deadline_at)}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Request a file">
          {detail && selected ? (
            <form
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!file.trim() || !issue.trim() || busy) return;
                setBusy(true);
                setNotice("");
                try {
                  const saved = await api.requestFilingHelp(
                    detail.incident.id,
                    selected.matter_code,
                    `File needed: ${file.trim()}\nIssue: ${issue.trim()}`,
                  );
                  setNotice(`Request #${saved.request_id} saved.`);
                  setFile("");
                  setIssue("");
                  refresh();
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Could not save the request.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="block">
                Case
                <select
                  className={input}
                  value={selected.matter_code}
                  onChange={(e) => setMatterCode(e.target.value)}
                >
                  {eligible.map((matter) => (
                    <option key={matter.matter_code} value={matter.matter_code}>
                      {matter.matter_code} · {matter.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                File needed
                <input
                  className={input}
                  value={file}
                  onChange={(e) => setFile(e.target.value)}
                  required
                  maxLength={250}
                />
              </label>
              <label className="block">
                Issue
                <textarea
                  className={input}
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  required
                  maxLength={700}
                />
              </label>
              <Btn type="submit" disabled={busy}>
                {busy ? "Submitting…" : "Submit request"}
              </Btn>
            </form>
          ) : (
            <p>
              {requests.length
                ? "You already requested help for the available filings."
                : "A filing linked to an active incident is needed to request a file."}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-3">
              {notice}
            </p>
          )}
        </Panel>
      </div>
      <Panel title="My requests" className="mt-5">
        {requests.length === 0 && <p>No requests yet.</p>}
        {requests.map((request) => (
          <article className="border-b py-3 last:border-0" key={request.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              #{request.id} · {request.matter_code}
              <StatusPill r={request} />
            </div>
            <p className="whitespace-pre-line text-sm">{request.body}</p>
            {request.owner_name && (
              <p className="text-sm text-muted-foreground">Assigned to {request.owner_name}</p>
            )}
            {request.status === "done" && (
              <p className="text-safe">IT marked this request complete.</p>
            )}
          </article>
        ))}
      </Panel>
    </>
  );
}
