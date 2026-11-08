import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, fmtTime } from "@/lib/api";
import { useVigil } from "@/lib/vigil-store";
import {
  ActivityList,
  Btn,
  PageTitle,
  Panel,
  RequireRole,
  StatusPill,
} from "@/components/vigil-ui";

export const Route = createFileRoute("/it")({
  component: () => (
    <RequireRole role="it">
      <IT />
    </RequireRole>
  ),
});

function IT() {
  const { detail, user, refresh } = useVigil();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requests = detail?.requests ?? [];
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update the request.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle eyebrow="IT Help Desk & Technical IT" title="IT Team">
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
      <Panel title="Request queue" sub={`· ${requests.length} total`}>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {requests.length === 0 && <p>No filing requests yet.</p>}
        {detail &&
          requests.map((request) => {
            const task = detail.tasks.find((item) => item.id === request.task_id);
            return (
              <article key={request.id} className="grid gap-2 border-b py-4 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong>
                    #{request.id} · {request.matter_code}
                  </strong>
                  <StatusPill r={request} />
                </div>
                <p className="whitespace-pre-line text-sm">{request.body}</p>
                {task && (
                  <p className="text-sm">
                    {task.title} · Due {fmtTime(task.due_at)}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  Triage {request.provider ?? request.triage_status ?? "pending"} · Phone alert{" "}
                  {request.alert_status ?? "unavailable"}
                </p>
                {request.triage_error && (
                  <p className="text-sm text-destructive">{request.triage_error}</p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  {request.owner_name && <span>Owner: {request.owner_name}</span>}
                  {task && !request.owner_user_id && request.status !== "done" && (
                    <Btn
                      disabled={busy}
                      onClick={() => void run(() => api.claimTask(detail.incident.id, task.id))}
                    >
                      Claim task
                    </Btn>
                  )}
                  {task && request.status === "claimed" && request.owner_user_id === user?.id && (
                    <Btn
                      tone="safe"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api.updateTask(detail.incident.id, task.id, { status: "done" }),
                        )
                      }
                    >
                      Mark complete
                    </Btn>
                  )}
                  {request.triage_status === "failed" && request.triage_id && (
                    <Btn
                      disabled={busy}
                      onClick={() => void run(() => api.retryITTriage(request.triage_id!))}
                    >
                      Retry triage
                    </Btn>
                  )}
                </div>
              </article>
            );
          })}
      </Panel>
      <Panel title="Photon activity" className="mt-5">
        <p className="mb-3 text-sm">
          Reply from the on-call phone using the instructions in the alert. Vigil updates the queue
          when Photon records the reply.
        </p>
        <ActivityList
          items={
            detail?.timeline.filter((event) =>
              /photon|alert|acknowledg|claimed/i.test(event.summary),
            ) ?? []
          }
        />
      </Panel>
    </>
  );
}
