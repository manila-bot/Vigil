// SAMPLE DATA MODE (`npm run dev:mock`). Uses JSON generated from the real backend
// (backend/scripts/make_api_fixtures.py), so the shapes match the live API exactly.
import login from "../mocks/login.json";
import dashboard from "../mocks/dashboard.json";
import afterSimulate from "../mocks/incident_after_simulate.json";
import withDraft from "../mocks/incident_with_triage_draft.json";
import full from "../mocks/incident_full.json";
import usersAdmin from "../mocks/users_admin_view.json";
import systemStatus from "../mocks/system_status.json";
import simulateNormal from "../mocks/simulate_normal.json";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let incident: any = clone(afterSimulate);
let users: any[] = clone(usersAdmin);
const stamp = () => new Date().toISOString();

function withTimelineEvent(summary: string, kind: string) {
  incident.timeline.push({ id: Date.now(), at: stamp(), kind, summary, actor_name: login.user.name, detail: {} });
}

export async function mockRequest(method: string, path: string, body: any): Promise<any> {
  await new Promise((r) => setTimeout(r, 250)); // feel like a network
  const p = path.split("?")[0];
  if (p === "/auth/login") return { ...login, token: "mock-token" };
  if (p === "/auth/me") return login.user;
  if (p === "/auth/logout") return { ok: true };
  if (p === "/system/status") return systemStatus;
  if (p === "/dashboard") return dashboard;
  if (p === "/users" && method === "GET") return users;
  if (p === "/users" && method === "POST") {
    const u = { id: users.length + 10, active: true, alert_opt_in: !!body.alert_opt_in, phone_masked: null,
      created_at: stamp(), team_role: body.team_role ?? null, email: body.email, name: body.name, role: body.role };
    users = [...users, u];
    return u;
  }
  if (p.startsWith("/users/") && method === "PATCH") {
    const id = Number(p.split("/")[2]);
    users = users.map((u) => (u.id === id ? { ...u, ...body } : u));
    return users.find((u) => u.id === id);
  }
  if (p === "/demo/simulate") {
    if (body?.fixture === "normal_activity") return simulateNormal;
    incident = clone(afterSimulate);
    return { detected: true, created: true, incident_id: incident.incident.id, incident };
  }
  if (p === "/incidents") return [{ ...incident.incident, open_tasks: incident.counts.open_tasks }];
  const m = p.match(/^\/incidents\/(\d+)(\/.*)?$/);
  if (m) {
    const action = m[2] ?? "";
    if (action === "/triage") incident = clone(withDraft);
    else if (action === "/approve" || action === "/notify") {
      const msgs = incident.messages;
      incident = clone(full);
      incident.messages = msgs;
      if (action === "/notify") return { ...incident, notify_result: { duplicate: false } };
      incident.notifications = [];
    } else if (action === "/messages" && method === "POST") {
      incident.messages.push({ id: Date.now(), user_id: login.user.id, user_name: login.user.name,
        team_role: login.user.team_role, body: body.body, created_at: stamp() });
      withTimelineEvent(`${login.user.name}: ${body.body}`, "message");
    } else if (action.startsWith("/scope/") && method === "PATCH") {
      const id = Number(action.split("/")[2]);
      incident.scope = incident.scope.map((s: any) => (s.id === id ? { ...s, ...body } : s));
      withTimelineEvent("Scope updated", "scope_updated");
    } else if (action.startsWith("/tasks/") && method === "PATCH") {
      const id = Number(action.split("/")[2]);
      incident.tasks = incident.tasks.map((t: any) => (t.id === id ? { ...t, ...body } : t));
      withTimelineEvent("Task updated", "task_updated");
    } else if (method === "PATCH" && action === "") {
      incident.incident = { ...incident.incident, ...body };
      withTimelineEvent(`Incident updated`, "incident_updated");
    }
    return { ...incident, server_time: stamp() };
  }
  throw new Error(`Mock has no data for ${method} ${path}`);
}
