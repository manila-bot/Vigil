import { createFileRoute, Link } from "@tanstack/react-router";
import { fmtTime } from "@/lib/api";
import { useVigil } from "@/lib/vigil-store";
import { ActivityList, PageTitle, Panel, StatusPill, RequireRole } from "@/components/vigil-ui";
import { Sparkline } from "@/components/Sparkline";

export const Route = createFileRoute("/admin")({
  component: () => (
    <RequireRole role="admin">
      <Admin />
    </RequireRole>
  ),
});

function Admin() {
  const { detail } = useVigil();
  const requests = detail?.requests ?? [];
  return (
    <>
      <PageTitle eyebrow="Admin" title="Incident command">
        <Link to="/access" className="text-primary">
          Manage access
        </Link>
        {detail && (
          <Link
            to="/incidents/$id"
            params={{ id: String(detail.incident.id) }}
            className="text-primary"
          >
            Open incident workspace
          </Link>
        )}
      </PageTitle>
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Incident overview">
          <p>{detail?.incident.title ?? "No active incident"}</p>
          {detail && (
            <p className="text-xs text-muted-foreground">{fmtTime(detail.incident.detected_at)}</p>
          )}
          <Sparkline attack={Boolean(detail)} height={50} />
        </Panel>
        <Panel title="IT Help Desk">
          <p>{requests.length} incoming</p>
          <p>
            {
              requests.filter((request) => !request.owner_user_id && request.status !== "done")
                .length
            }{" "}
            waiting for an owner
          </p>
        </Panel>
        <Panel title="Technical IT">
          <p>{requests.filter((request) => request.status === "claimed").length} in progress</p>
          <p>{requests.filter((request) => request.status === "done").length} completed</p>
        </Panel>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Urgent requests">
          {requests.length === 0 && <p>No requests yet.</p>}
          {requests.map((request) => (
            <div key={request.id} className="flex justify-between gap-3 border-b py-2">
              <span>
                #{request.id} · {request.matter_code}
              </span>
              <StatusPill r={request} />
            </div>
          ))}
        </Panel>
        <Panel title="Activity history">
          <ActivityList items={detail?.timeline ?? []} />
        </Panel>
      </div>
    </>
  );
}
